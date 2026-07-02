# ============================================================
# Hierarchical model for Experiment 1a: colored mazes. 
# ============================================================
import numpy as np
import pandas as pd
import jax
import jax.numpy as jnp
import numpyro
import numpyro.distributions as dist
from numpyro.infer import MCMC, NUTS
import pickle
import os

def sol_driven_model_NUTS(num_warmup=1000, num_samples=1000, num_chains=2, rng_seed=0, update_mode="observed"):
    
    print("num_warmup={0}, num_samples={1}, num_chains={2}, seed={3}, update_mode={4}".format(num_warmup, num_samples, num_chains, rng_seed, update_mode))

    # Set the number of CPU devices for parallel chains (e.g., 4)
    numpyro.set_host_device_count(num_chains) 
    import jax # Import JAX after setting host device count
    num_devices_after_config = jax.local_device_count()
    print("Number of JAX devices after configuration:", str(num_devices_after_config))
    
    # 1) Load human data
    df_human_modeling = pd.read_csv(os.path.join("solution_driven", "data", "exp1_df_human_modeling.csv"))
    cols_to_parse = [
        "maze_grid",
        "start_pos",
        "goal_pos",
        "search_path",
        "cache_mask",
        "cache_valid",
    ]
    for col in cols_to_parse:
        df_human_modeling[col] = df_human_modeling[col].apply(
            lambda x: ast.literal_eval(x) if pd.notnull(x) else x
        )
        
    # 2) Parse human dataframe into Numpyro format
    inputs = prepare_numpyro_inputs(df_human_modeling, sort_by=("subj_idx","block", "trial"))
    # 3) Fit Numpyro model
    mcmc = fit_nuts_np(inputs, num_warmup=num_warmup, num_samples=num_samples, num_chains=num_chains,
                       rng_seed=rng_seed, update_mode=update_mode, n_subj=len(np.unique(inputs["subj_idx"])), 
                       chain_method="parallel")
    # Collect the results
    posterior_samples = mcmc.get_samples()
#     _ = summarize_posterior_mcmc_np(mcmc)
#     pp_mean, pp_draws = posterior_predictive_probs_np(mcmc, data)
#     acc = np.mean(((pp_mean > 0.5).astype(np.float32) == np.array(data["y"])))
#     print("Posterior predictive mean accuracy:", float(acc))

    # 4) Save the results
    file_path = os.path.join("solution_driven", "model_fits","numpyro_"+str(num_warmup)+"_"+str(num_samples)+"_"+str(update_mode)+"_seed"+str(rng_seed)+".pickle")
    a = {"inputs":inputs, "posterior_samples":posterior_samples, "num_warmup": num_warmup, "num_samples": num_samples, "num_chains": num_chains, "rng_seed": rng_seed, "update_mode": update_mode}
    with open(file_path, 'wb') as file_handle:
        pickle.dump(a, file_handle, protocol=pickle.HIGHEST_PROTOCOL)
    print("Data files saved.")
    mcmc.print_summary()
    

    
# -----------------------
# 0) Prepare tensors (-> JAX DeviceArrays)
# -----------------------

def prepare_numpyro_inputs(
    df_subject_block: pd.DataFrame,
    subj_col: str = "subj_idx",
    cond_col: str = "cond",
    cache_mask_col: str = "cache_mask",
    cache_valid_col: str = "cache_valid",
    search_path_len_col: str = "search_path_len",
    search_cost_col: str = "search_cost",
    search_found_col: str = "search_found",
    search_solution_slot_col: str = "search_solution_slot",
    obs_solution_slot_col: str = "obs_solution_slot",
    sort_by=("block", "trial"),
    return_metadata: bool = True,
):
    """
    Convert one subject dataframe into NumPy arrays for the NumPyro model.

    Critical:
    ---------
    Trials are sorted in true temporal order, defaulting to:
        block -> trial

    Label convention:
        0 = search
        1 = reuse left
        2 = reuse right
    """
    df = df_subject_block.copy()

    if len(df) == 0:
        raise ValueError("df_subject_block is empty.")

    missing_sort = [c for c in sort_by if c not in df.columns]
    if missing_sort:
        raise ValueError(f"Missing sort columns: {missing_sort}")
    df = df.sort_values(list(sort_by)).reset_index(drop=True)

    required = [
        subj_col,
        cond_col,
        cache_mask_col,
        cache_valid_col,
        search_path_len_col,
        search_cost_col,
        search_found_col,
        search_solution_slot_col,
        obs_solution_slot_col,
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    # Condition mapping: smaller value -> 0, larger value -> 1
    cond_vals = pd.unique(df[cond_col])
    cond_vals = [x for x in cond_vals if pd.notnull(x)]
    if len(cond_vals) == 0:
        raise ValueError(f"No non-null values found in '{cond_col}'.")

    cond_vals_sorted = sorted(cond_vals)
    if len(cond_vals_sorted) == 1:
        cond_map = {cond_vals_sorted[0]: 0}
    elif len(cond_vals_sorted) == 2:
        cond_map = {
            cond_vals_sorted[0]: 0,
            cond_vals_sorted[1]: 1,
        }
    else:
        raise ValueError(
            f"Expected 1 or 2 unique condition values in '{cond_col}', got {cond_vals_sorted}."
        )

    cond_idx = df[cond_col].map(cond_map).to_numpy(dtype=np.int32)

    def _to_len2_array(x, name):
        arr = np.asarray(x, dtype=np.float32)
        if arr.shape != (2,):
            raise ValueError(f"{name} entry must have shape (2,), got {arr.shape} with value {x}")
        return arr

    cache_mask = np.stack(
        [_to_len2_array(x, cache_mask_col) for x in df[cache_mask_col].tolist()],
        axis=0
    ).astype(np.float32)

    cache_valid = np.stack(
        [_to_len2_array(x, cache_valid_col) for x in df[cache_valid_col].tolist()],
        axis=0
    ).astype(np.float32)

    subj = df[subj_col].to_numpy(dtype=np.int32)
    search_path_len = df[search_path_len_col].to_numpy(dtype=np.float32)
    search_cost = df[search_cost_col].to_numpy(dtype=np.float32)
    search_found = df[search_found_col].to_numpy(dtype=np.int32)
    search_solution_slot = df[search_solution_slot_col].to_numpy(dtype=np.int32)
    obs_solution_slot = df[obs_solution_slot_col].to_numpy(dtype=np.int32)

    T = len(df)

    if cache_mask.shape != (T, 2):
        raise ValueError(f"cache_mask has shape {cache_mask.shape}, expected ({T}, 2)")
    if cache_valid.shape != (T, 2):
        raise ValueError(f"cache_valid has shape {cache_valid.shape}, expected ({T}, 2)")

    if np.any(~np.isin(search_found, [0, 1])):
        raise ValueError("search_found must contain only 0/1.")
    if np.any(~np.isin(search_solution_slot, [0, 1, 2])):
        raise ValueError("search_solution_slot must contain only {0,1,2}.")
    if np.any(~np.isin(obs_solution_slot, [0, 1, 2])):
        raise ValueError("obs_solution_slot must contain only {0,1,2}.")
    if np.any((cache_mask != 0) & (cache_mask != 1)):
        raise ValueError("cache_mask entries must be 0/1.")
    if np.any((cache_valid != 0) & (cache_valid != 1)):
        raise ValueError("cache_valid entries must be 0/1.")

    out = {
        "subj_idx": subj,
        "cond_idx": cond_idx,
        "cache_mask": cache_mask,
        "cache_valid": cache_valid,
        "search_path_len": search_path_len,
        "search_cost": search_cost,
        "search_found": search_found,
        "search_solution_slot": search_solution_slot,
        "obs_solution_slot": obs_solution_slot,
    }

    if return_metadata:
        meta = {
            "n_trials": T,
            "condition_mapping": cond_map,
            "sort_by": tuple(sort_by),
            "columns_used": {
                "subj": subj_col,
                "cond": cond_col,
                "cache_mask": cache_mask_col,
                "cache_valid": cache_valid_col,
                "search_path_len": search_path_len,
                "search_cost": search_cost_col,
                "search_found": search_found_col,
                "search_solution_slot": search_solution_slot_col,
                "obs_solution_slot": obs_solution_slot_col,
            },
        }
        for maybe_col in ["Subj", "subj", "subject", "block", "first_cond"]:
            if maybe_col in df.columns:
                vals = df[maybe_col].unique().tolist()
                meta[maybe_col] = vals[0] if len(vals) == 1 else vals

        out["metadata"] = meta

    return out

# -----------------------
# 1) Numpyro model (hierarchical group- and subject-level params)
# -----------------------

def _safe_normalize(x, eps=1e-12):
    s = jnp.sum(x)
    n = x.shape[0]
    return jnp.where(s > eps, x / s, jnp.ones_like(x) / n)


def _masked_normalize(x, mask, eps=1e-12):
    x = x * mask
    s = jnp.sum(x)
    n_active = jnp.sum(mask)

    uniform = jnp.where(
        n_active > 0,
        mask / jnp.maximum(n_active, 1.0),
        jnp.zeros_like(x),
    )
    return jnp.where(s > eps, x / s, uniform)


def _delta_update_probs(probs, chosen_idx, alpha, mask=None):
    onehot = jax.nn.one_hot(chosen_idx, probs.shape[0], dtype=probs.dtype)
    updated = (1.0 - alpha) * probs + alpha * onehot
    if mask is None:
        return _safe_normalize(updated)
    return _masked_normalize(updated, mask)


def _bernoulli_flip_prob(valid01, lam):
    valid01 = valid01.astype(jnp.float32)
    return valid01 * (1.0 - lam) + (1.0 - valid01) * lam


def _sample_logit_normal_hierarchical(name, n_subj,
                                      mu_loc=0.0, mu_scale=1.0,
                                      sigma_scale=0.7):
    """
    Returns subject-level parameter in (0,1) using a hierarchical
    logistic-normal prior:
        z_s ~ Normal(mu, sigma)
        theta_s = sigmoid(z_s)

    This is often easier to fit hierarchically than Beta-on-Beta constructions.
    """
    mu = numpyro.sample(f"mu_{name}", dist.Normal(mu_loc, mu_scale))
    sigma = numpyro.sample(f"sigma_{name}", dist.HalfNormal(sigma_scale))
    with numpyro.plate(f"subj_{name}_plate", n_subj):
        z = numpyro.sample(f"z_{name}", dist.Normal(mu, sigma))
    theta = numpyro.deterministic(name, jax.nn.sigmoid(z))
    return theta


def colored_maze_reuse_model_marginalized_hierarchical(
    subj_idx,                  # shape [T], integer-coded 0..S-1
    cond_idx,                  # shape [T], integer-coded, e.g. 0 easy, 1 hard
    cache_mask,                # shape [T, 2]
    cache_valid,               # shape [T, 2]
    search_cost,               # shape [T]
    search_found,              # shape [T]
    history_solution_slot=None,  # shape [T], used only in observed mode
    obs_solution_slot=None,      # shape [T], optional conditioning target
    update_mode="observed",      # "observed" or "sampled"
    reset_on_cond_change=True,
    reset_on_subj_change=True,
    n_subj=72,
    hierarchical_budget=True,   # optional switch if you later want B_easy by subject
):
    """
    Label convention:
        0 = final submission from search
        1 = final submission from reuse-left
        2 = final submission from reuse-right

    Assumptions:
    - Data are sorted in temporal order within subject.
    - If multiple subjects are concatenated, trials for each subject should also
      appear in temporal order.
    - subj_idx should be integer-coded from 0..S-1.

    Hierarchical choice:
    - Subject-specific (partially pooled): alpha_strategy, alpha_reuse, lambda, lapse
    - Global by default: B_easy, b_frac
    """

    if update_mode not in ("observed", "sampled"):
        raise ValueError("update_mode must be 'observed' or 'sampled'")

    T, K = cache_mask.shape
    if K != 2:
        raise ValueError("Expected K=2 cache slots (left/right).")

    # -----------------------------
    # Hierarchical subject-level params in (0,1)
    # -----------------------------
    alpha_strategy_subj = _sample_logit_normal_hierarchical(
        "alpha_strategy_subj", n_subj,
        mu_loc=0.0, mu_scale=1.0, sigma_scale=0.7
    )
    alpha_reuse_subj = _sample_logit_normal_hierarchical(
        "alpha_reuse_subj", n_subj,
        mu_loc=0.0, mu_scale=1.0, sigma_scale=0.7
    )
    lam_subj = _sample_logit_normal_hierarchical(
        "lambda_subj", n_subj,
        mu_loc=-1.5, mu_scale=1.0, sigma_scale=0.7
    )
    lapse_subj = _sample_logit_normal_hierarchical(
        "lapse_subj", n_subj,
        mu_loc=-3.0, mu_scale=1.0, sigma_scale=0.7
    )

    # -----------------------------
    # Search budget parameters
    # Keep global by default to avoid weak identification / too much effective complexity
    # -----------------------------
    if hierarchical_budget:
        # Optional: partially pooled subject-specific B_easy
        mu_log_B_easy = numpyro.sample("mu_log_B_easy", dist.Normal(jnp.log(120.0), 0.6))
        sigma_log_B_easy = numpyro.sample("sigma_log_B_easy", dist.HalfNormal(0.5))
        with numpyro.plate("subj_budget_plate", n_subj):
            log_B_easy_subj = numpyro.sample(
                "log_B_easy_subj",
                dist.Normal(mu_log_B_easy, sigma_log_B_easy)
            )
        B_easy_subj = numpyro.deterministic("B_easy_subj", jnp.exp(log_B_easy_subj))

        mu_b_frac_logit = numpyro.sample("mu_b_frac_logit", dist.Normal(-1.0, 1.0))
        sigma_b_frac_logit = numpyro.sample("sigma_b_frac_logit", dist.HalfNormal(0.7))
        with numpyro.plate("subj_bfrac_plate", n_subj):
            z_b_frac = numpyro.sample("z_b_frac", dist.Normal(mu_b_frac_logit, sigma_b_frac_logit))
        b_frac_subj = numpyro.deterministic("b_frac_subj", jax.nn.sigmoid(z_b_frac))
        B_hard_subj = numpyro.deterministic("B_hard_subj", B_easy_subj * b_frac_subj)
    else:
        B_easy = numpyro.sample(
            "B_easy",
            dist.TruncatedNormal(loc=170.0, scale=50.0, low=0.0, high=208.0)
        )
        b_frac = numpyro.sample("b_frac", dist.Beta(1, 2))
        B_hard = numpyro.deterministic("B_hard", B_easy * b_frac)

    # -----------------------------
    # Initialize dynamic state
    # -----------------------------
    first_active = cache_mask[0].astype(jnp.float32)

    meta_probs = jnp.array([0.5, 0.5], dtype=jnp.float32)  # [search, reuse]
    reuse_probs = _masked_normalize(
        jnp.ones((K,), dtype=jnp.float32),
        first_active
    )

    obs_prob_list = []
    meta_hist = []
    reuse_hist = []

    for t in range(T):
        s = subj_idx[t]
        active = cache_mask[t].astype(jnp.float32)
        valid = cache_valid[t].astype(jnp.float32)

        # Subject-specific params for current trial
        alpha_strategy_t = alpha_strategy_subj[s]
        alpha_reuse_t = alpha_reuse_subj[s]
        lam_t = lam_subj[s]
        lapse_t = lapse_subj[s]

        # ---------------------------------
        # Optional resets
        # ---------------------------------
        if t > 0:
            reset_flag = False

            if reset_on_cond_change:
                reset_flag = reset_flag | (cond_idx[t] != cond_idx[t - 1])

            if reset_on_subj_change:
                reset_flag = reset_flag | (subj_idx[t] != subj_idx[t - 1])

            reset_meta = jnp.array([0.5, 0.5], dtype=jnp.float32)
            reset_reuse = _masked_normalize(
                jnp.ones((K,), dtype=jnp.float32),
                active
            )

            meta_probs = jnp.where(reset_flag, reset_meta, meta_probs)
            reuse_probs = jnp.where(reset_flag, reset_reuse, reuse_probs)

        # Enforce active-slot masking every trial
        reuse_probs = _masked_normalize(reuse_probs, active)

        # ---------------------------------
        # Search success
        # ---------------------------------
        if hierarchical_budget:
            B_t = jnp.where(cond_idx[t] == 0, B_easy_subj[s], B_hard_subj[s])
        else:
            B_t = jnp.where(cond_idx[t] == 0, B_easy, B_hard)

        search_success = (
            (search_found[t] == 1) & (search_cost[t] <= B_t)
        ).astype(jnp.float32)

        # ---------------------------------
        # Reuse success
        # ---------------------------------
        q_valid = _bernoulli_flip_prob(valid, lam_t) * active
        reuse_success_by_slot = reuse_probs * q_valid
        p_reuse_succeeds = jnp.sum(reuse_success_by_slot)

        p_slot_given_reuse_success = _masked_normalize(reuse_success_by_slot, active)

        # ---------------------------------
        # Observation distribution
        # ---------------------------------
        p0 = (
            meta_probs[0] * search_success
            + meta_probs[1] * (1.0 - p_reuse_succeeds) * search_success
        )

        p_reuse_total = (
            meta_probs[1]
            + meta_probs[0] * (1.0 - search_success)
        ) * p_reuse_succeeds

        p12 = p_reuse_total * p_slot_given_reuse_success

        p_obs_raw = jnp.concatenate([jnp.array([p0]), p12], axis=0)
        p_obs_core = _safe_normalize(p_obs_raw)
        p_obs = (1.0 - lapse_t) * p_obs_core + lapse_t * (jnp.ones(3) / 3.0)
        p_obs = _safe_normalize(p_obs)

        numpyro.deterministic(f"p_obs_{t}", p_obs)
        obs_prob_list.append(p_obs)

        # ---------------------------------
        # Likelihood
        # ---------------------------------
        y_obs = None if obs_solution_slot is None else obs_solution_slot[t]
        y_t = numpyro.sample(f"obs_{t}", dist.Categorical(probs=p_obs), obs=y_obs)

        # ---------------------------------
        # State update choice
        # ---------------------------------
        if update_mode == "observed":
            if history_solution_slot is None:
                raise ValueError("update_mode='observed' requires history_solution_slot.")
            y_update = history_solution_slot[t]
        else:
            y_update = y_t

        # Meta update: 0 => search, 1/2 => reuse
        meta_choice_idx = jnp.where(y_update == 0, 0, 1)
        meta_probs = _delta_update_probs(
            meta_probs,
            meta_choice_idx,
            alpha_strategy_t
        )

        # Reuse update only if actual final submission was from reuse
        chosen_cache_idx = jnp.clip(y_update - 1, 0, K - 1)
        reuse_probs_candidate = _delta_update_probs(
            reuse_probs,
            chosen_cache_idx,
            alpha_reuse_t,
            mask=active
        )
        reuse_probs = jnp.where(y_update == 0, reuse_probs, reuse_probs_candidate)

        meta_hist.append(meta_probs)
        reuse_hist.append(reuse_probs)

    numpyro.deterministic("obs_probs", jnp.stack(obs_prob_list))
    numpyro.deterministic("meta_hist", jnp.stack(meta_hist))
    numpyro.deterministic("reuse_hist", jnp.stack(reuse_hist))

# -----------------------
# 2) Fit with NUTS / MCMC
# -----------------------
def fit_nuts_np(inputs, num_warmup=1000, num_samples=1000, num_chains=1,
                rng_seed=0, update_mode="observed", n_subj=72, progress_bar=True, chain_method="sequential",
                target_accept_prob=0.9, max_tree_depth=12):
    """
    chain_method: "sequential" (safe everywhere) or "parallel" (requires XLA multi-processing support).
    """
    subj_idx = inputs["subj_idx"]
    cond_idx = inputs["cond_idx"]
    cache_mask = inputs["cache_mask"]
    cache_valid = inputs["cache_valid"]
    search_cost = inputs["search_cost"]
    search_found = inputs["search_found"]
    search_solution_slot = inputs["search_solution_slot"]
    obs_solution_slot = inputs["obs_solution_slot"]
    

    numpyro.set_host_device_count(num_chains)
    kernel = NUTS(colored_maze_reuse_model_marginalized,
                  target_accept_prob=target_accept_prob,
                  max_tree_depth=max_tree_depth)

    mcmc = MCMC(kernel, num_warmup=num_warmup, num_samples=num_samples,
                num_chains=num_chains, progress_bar=progress_bar,
                chain_method=chain_method)

    rng_key = jax.random.PRNGKey(rng_seed)
    mcmc.run(
        rng_key,
        subj_idx=jnp.array(inputs["subj_idx"]),
        cond_idx=jnp.array(inputs["cond_idx"]),
        cache_mask=jnp.array(inputs["cache_mask"]),
        cache_valid=jnp.array(inputs["cache_valid"]),
        search_cost=jnp.array(inputs["search_cost"]),
        search_found=jnp.array(inputs["search_found"]),
        history_solution_slot=jnp.array(inputs["obs_solution_slot"]),
        obs_solution_slot=jnp.array(inputs["obs_solution_slot"]),
        update_mode=update_mode,
        n_subj=n_subj,
    )
    return mcmc

sol_driven_model_NUTS(num_warmup=2000, num_samples=2000, num_chains=4, rng_seed=0, update_mode="observed")