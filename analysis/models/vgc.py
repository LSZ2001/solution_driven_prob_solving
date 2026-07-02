import json
from itertools import chain, combinations
import random
import sys
from pathlib import Path


import numpy as np
from scipy.special import softmax
import pandas as pd
import joblib

from mdps import GridWorld

sys.path.append(str(Path(".").absolute() / "value-guided-construal"))

import vgc_project
from vgc_project.vgc import value_guided_construal
from vgc_project.dynamic_vgc import dynamic_vgc

exp_dvs = [
    "initial_awareness",
    "upfront_awareness",
    "critical_memory",
    "critical_confidence",
    "critical_awareness",
    "initial_loghover_duration",
    "initial_hover",
    "critical_loghover_duration",
    "critical_hover",
]

pars = {
    "initial_awareness": {
        "ground_policy_inv_temp": 1.00,
        "ground_policy_rand_choose": 0.20,
        "switching_inv_temp": 5.00,
        "switching_rand_choose": 0.05,
    },
    "upfront_awareness": {
        "ground_policy_inv_temp": 1.00,
        "ground_policy_rand_choose": 0.20,
        "switching_inv_temp": 5.00,
        "switching_rand_choose": 0.05,
    },
    "critical_memory": {
        "ground_policy_inv_temp": 3.00,
        "ground_policy_rand_choose": 0.20,
        "switching_inv_temp": 1.00,
        "switching_rand_choose": 0.05,
    },
    "critical_confidence": {
        "ground_policy_inv_temp": 5.00,
        "ground_policy_rand_choose": 0.00,
        "switching_inv_temp": 9.00,
        "switching_rand_choose": 0.20,
    },
    "critical_awareness": {
        "ground_policy_inv_temp": 3.00,
        "ground_policy_rand_choose": 0.10,
        "switching_inv_temp": 1.00,
        "switching_rand_choose": 0.05,
    },
    "initial_loghover_duration": {
        "ground_policy_inv_temp": 1.00,
        "ground_policy_rand_choose": 0.00,
        "switching_inv_temp": 9.00,
        "switching_rand_choose": 0.00,
    },
    "initial_hover": {
        "ground_policy_inv_temp": 7.00,
        "ground_policy_rand_choose": 0.20,
        "switching_inv_temp": 7.00,
        "switching_rand_choose": 0.30,
    },
    "critical_loghover_duration": {
        "ground_policy_inv_temp": 5.00,
        "ground_policy_rand_choose": 0.10,
        "switching_inv_temp": 1.00,
        "switching_rand_choose": 0.30,
    },
    "critical_hover": {
        "ground_policy_inv_temp": 5.00,
        "ground_policy_rand_choose": 0.10,
        "switching_inv_temp": 1.00,
        "switching_rand_choose": 0.30,
    },
}

mazes_0_11 = json.load(open("data/mazes_0-11.json"))
mazes_12_15 = json.load(open("data/mazes_12-15.json"))
mazes = {
    **{"-".join(k.split("-")[:-1]): tuple(v) for k, v in mazes_0_11.items()},
    **{k: tuple(v) for k, v in mazes_12_15.items()},
}

# mods = create_modeling_interface(joblib_cache_location="./_analysiscache")
joblibmemory = joblib.Memory("./_analysiscache", verbose=0)

value_guided_construal = joblibmemory.cache()(value_guided_construal)
dynamic_vgc = joblibmemory.cache()(dynamic_vgc)

model_preds = []
# seed = 72193880
seed = 21912491
# random.seed(seed)
for grid, tile_array in mazes.items():
    print(grid)
    for exp_dv, par in pars.items():
        print(exp_dv)
        static = value_guided_construal(
            tile_array=tile_array, construal_inverse_temp=10, discount_rate=1.0 - 1e-5
        )
        dynamic = dynamic_vgc(
            tile_array=tile_array,
            ground_policy_inv_temp=par["ground_policy_inv_temp"],
            ground_policy_rand_choose=par["ground_policy_rand_choose"],
            ground_discount_rate=1.0-1e-5,
            action_deviation_reward=0,
            wall_bias=0.0,
            wall_bump_cost=0.0,
            added_obs_cost=1,
            removed_obs_cost=0,
            continuing_obs_cost=0,
            construal_switch_cost=0.0,
            switching_inv_temp=par["switching_inv_temp"],
            switching_rand_choose=par["switching_rand_choose"],
            switching_discount_rate=1-1e-5,
            max_construal_size=3,
            n_simulations=100,
            seed=seed,
        )
        for obs in sorted(set("0123456789") & set.union(*[set(r) for r in tile_array])):
            preds = {
                "grid": grid,
                "dv": exp_dv,
                "obstacle": f"obs-{obs}",
                "static_vgc": static["obstacle_probs"][obs],
                "dynamic_vgc": dynamic["obs_prob"].get(obs, 0),
            }
            model_preds.append(preds)
            # preds = {
            #     "grid": grid,
            #     "obstacle": f"obs-{obs}",
            #     **mods.predictions(tile_array, obs, seed=72193880),
            # }
    print("===\n\n")
model_preds = pd.DataFrame(model_preds)
model_preds.to_csv("vgc_predictions.csv", index=False)

# def value_guided_construal(grid: GridWorld, start: tuple, alpha=0.1):
#     # the construal always starts with object "#" added
#     init_obj = grid.obstacles[grid.obstacle_names.index("#")]
#     obstacles = [o for n, o in zip(grid.obstacle_names, grid.obstacles) if n != "#"]
#     names = [n for n in grid.obstacle_names if n != "#"]

#     construals = list(powerset(range(len(obstacles))))

#     construal_values = []
#     iter = 0
#     for c in construals:
#         iter += 1
#         print(f"{iter} / {len(construals)}")
#         objs = [obstacles[i] for i in c]
#         objs.append(init_obj)
#         construal_grid = GridWorld(grid.width, grid.height, grid.goal, objs)
#         policy, data = value_iteration(construal_grid, 0.001)

#         v = score_policy(grid, policy)[start]
#         v -= len(c)
#         construal_values.append(v)

#     construal_values = softmax(np.array(construal_values) / alpha)

#     out = {"#": 1.0}
#     for i, (n, o) in enumerate(zip(names, obstacles)):
#         p_object = sum(p if i in c else 0 for c, p in zip(construals, construal_values))
#         out[n] = p_object

#     return out, {"construals": list(construals), "construal_values": construal_values}


# def powerset(s, max=None):
#     if max is None:
#         max = len(s) + 1
#     return chain.from_iterable(combinations(s, r) for r in range(max))

# def value_iteration(mdp, rtol=1e-3):
#     delta = 1
#     value = {s: 0.0 for s in mdp.states}
#     while rtol < delta:
#         delta = 0
#         for s in mdp.states:
#             old_value = value[s]
#             value[s] = max(
#                 mdp.reward(s, a) + mdp.discount * sum(p * value[n] for n, p in mdp.transition(s, a))
#                 for a in mdp.actions
#             )
#             # if s == (0, 0):
#             #     print(
#             #     {a: mdp.reward(s, a)
#             #     + mdp.discount * sum(p * value[n] for n, p in mdp.transition(s, a))
#             #     for a in mdp.actions}
#             #     )
#             delta = max(abs(value[s] - old_value), delta)
#         # print(delta)
#         # sleep(0.5)

#     return policy_from_value(mdp, value, 0.1), {"value": value, "delta": delta}

# def policy_from_value(mdp, value, eps):
#     tab_policy = {}
#     for s in value.keys():
#         vals = np.array([
#             mdp.reward(s, a)
#             + mdp.discount * sum(p * value.get(n, -float("inf")) for n, p in mdp.transition(s, a))
#             for a in mdp.actions
#         ])
#         action_probs = np.isclose(vals, np.max(vals)).astype(float)
#         action_probs /= action_probs.sum()
#         # action_probs = softmax(vals)
#         # action_probs[action_probs.argmax()] -= eps
#         # action_probs += eps / len(mdp.actions)

#         assert np.isclose(action_probs.sum(), 1.0)

#         # max_actions = [mdp.actions[i] for i, v in enumerate(vals) if np.isclose(v, max_val)]
#         tab_policy[s] = list(zip(mdp.actions, action_probs))

#     return tab_policy


# def score_policy(mdp, policy, rtol=1e-3):
#     delta = 1
#     value = {s: 0.0 for s in mdp.states}

#     while delta > rtol:
#         delta = 0
#         for s in mdp.states:
#             v = value[s]
#             value[s] = sum(
#                 a_prob *
#                 (
#                     mdp.reward(s, a)
#                     + mdp.discount * sum(p * value[n] for n, p in mdp.transition(s, a))
#                 )
#                 for a, a_prob in policy[s]
#             )
#             delta = max(delta, abs(v - value[s]))

#     return value
