import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--param_sim_idx", type=int, default=0, help="which comb of parameters to run simulation on")
parser.add_argument("--n_sims", type=int, default=100, help="Number of simulations run by A*")
parser.add_argument("--seed", type=int, default=0, help="Seed for stochastic A*")
args = parser.parse_args()

# Dataset extraction
param_sim_idx = args.param_sim_idx
n_sims= args.n_sims
seed = args.seed



def jit_simulation_helper(param_sim_idx=0, n_sims = 100, seed=0):
    
    import numpy as np
    import scipy 
    import matplotlib.pyplot as plt
    import pandas as pd
    import random
    import os
    import pickle
    import glob 
    import itertools
    import json
    from collections import Counter
    import ast
    from collections import deque
    import matplotlib.cm as cm
    from matplotlib import gridspec
    import matplotlib.patches as patches
    import math
    from copy import deepcopy
    import pickle
    import heapq

    import models.mdps as mdps
    import models.jit as jit

    start_goal_pos = [(8,1),(8,15)]


    figpath = os.path.join("solution_driven","fig")
    fitspath = os.path.join("solution_driven","modelfits")
    data_savepath = os.path.join("solution_driven","data")

    def maze_to_char_array(maze):
        return np.array([list(row) for row in maze])

    # Load the object as a pickle file
    with open(os.path.join("solution_driven","test_mazes.pkl"), 'rb') as file:
        test_mazes = pickle.load(file)

    maze_size = len(test_mazes)

    def location_on_shared_walls(r,c, n_rows, n_cols):
        if(r==1 or r==(n_rows-2)):
            if(c>0 and c<(n_cols-1)):
                return True
        elif(c==1 or c==(n_cols-2)):
            if(r>0 and r<(n_rows-1)):
                return True
        return False


    def parse_maze_with_numbered_walls(
        maze_arr,
        start=(8,1),
        goal=(8,15),
        wall_start_idx=0,
    ):
        """
        Convert a maze char array into a labeled object array.

        Parameters
        ----------
        maze_arr : np.ndarray
            2D array from maze_to_char_array(), containing symbols like
            '+', '-', '.', '#'
        start : tuple or None
            (row, col) coordinate to label as 'S'
        goal : tuple or None
            (row, col) coordinate to label as 'G'
        wall_start_idx : int
            Starting integer for numbering '#' cells

        Returns
        -------
        out : np.ndarray
            2D object array of strings, where:
            - '+', '-', '.' become '.'
            - each '#' becomes a unique string integer
            - start becomes 'S'
            - goal becomes 'G'
        """
        maze_arr = np.asarray(maze_arr)
        if maze_arr.ndim != 2:
            raise ValueError(f"maze_arr must be 2D, got shape {maze_arr.shape}")

        n_rows, n_cols = maze_arr.shape
        out = np.empty((n_rows, n_cols), dtype=object)

        wall_counter = wall_start_idx

        shared_construal = []

        for r in range(n_rows):
            for c in range(n_cols):
                val = maze_arr[r, c]

                if val in ['+', '-', '.']:
                    out[r, c] = '.'
                elif val == '#':
                    out[r, c] = str(wall_counter)
                    if(location_on_shared_walls(r,c,n_rows,n_cols)): # The shared maze walls across mazes
                        shared_construal.append(wall_counter)
                    wall_counter += 1
                else:
                    raise ValueError(f"Unexpected maze symbol {val!r} at {(r, c)}")

        # overwrite start / goal after wall numbering
        if start is not None:
            sr, sc = start
            if not (0 <= sr < n_rows and 0 <= sc < n_cols):
                raise ValueError(f"start {start} is out of bounds for maze shape {maze_arr.shape}")
            out[sc, sr] = 'S'

        if goal is not None:
            gr, gc = goal
            if not (0 <= gr < n_rows and 0 <= gc < n_cols):
                raise ValueError(f"goal {goal} is out of bounds for maze shape {maze_arr.shape}")
            out[gc, gr] = 'G'

        return out, shared_construal


    def maze_to_char_array(maze):
        return np.array([list(row) for row in maze])


    def build_original_maze_bg(maze_arr):
        """
        wall(#) -> 0
        open    -> 1
        """
        bg = np.ones(maze_arr.shape, dtype=float)
        bg[maze_arr == '#'] = 0.0
        return bg


    def build_state_occupancy_map(paths, maze_shape, xy_to_rc=True, binary_per_rollout=False):
        """
        Build occupancy map from simulated paths.
        xy_to_rc=True means each path point is (x, y) and should map to occ[y, x].
        """
        occ = np.zeros(maze_shape, dtype=float)

        for path in paths:
            this_occ = np.zeros(maze_shape, dtype=float)

            for pos in path:
                a, b = pos[:2]

                if xy_to_rc:
                    x, y = int(a), int(b)
                    r, c = y, x
                else:
                    r, c = int(a), int(b)

                if 0 <= r < maze_shape[0] and 0 <= c < maze_shape[1]:
                    if binary_per_rollout:
                        this_occ[r, c] = 1
                    else:
                        this_occ[r, c] += 1

            occ += this_occ

        return occ


    def build_obstacle_prob_map(parsed_maze, probs):
        """
        Map probs[j] onto numbered wall cells labeled 'j+1' in parsed_maze.
        Non-wall cells are NaN.
        """
        n_rows, n_cols = parsed_maze.shape
        prob_map = np.full((n_rows, n_cols), np.nan, dtype=float)

        for r in range(n_rows):
            for c in range(n_cols):
                val = parsed_maze[r, c]
                if isinstance(val, str) and val.isdigit():
                    idx = int(val)
                    if 0 <= idx < len(probs):
                        prob_map[r, c] = probs[idx]

        return prob_map


    def run_jit_on_single_maze(
        test_maze,
        start_goal_pos,
        pars,
        n_sims=100,
        seed=45,
        xy_to_rc=True,
        binary_per_rollout=False,
        maze_size = 16,
        verbose=False,
    ):
        """
        Run JIT rollout repeatedly on one maze.

        Parameters
        ----------
        test_maze : maze in original string-list format
        start_goal_pos : tuple/list like [(start_row, start_col), (goal_row, goal_col)]
        pars : jit.AStarPars
        n_sims : int
        seed : int
        xy_to_rc : bool
            For occupancy map construction.
        binary_per_rollout : bool
            If True, occupancy counts unique visited cells per rollout.
        verbose : bool

        Returns
        -------
        result : dict with keys
            maze_arr
            parsed_maze
            g
            paths
            construals
            probs
            occ
            prob_map
        """
        maze_arr = maze_to_char_array(test_maze)
        parsed_maze, init_construal = parse_maze_with_numbered_walls(
            maze_arr,
            start=start_goal_pos[0],
            goal=start_goal_pos[1]
        )

        g = mdps.GridWorld.from_string(parsed_maze)

        probs = np.zeros(len(g.obstacles), dtype=float)
        paths = []
        construals = []

        random.seed(seed)

        for i in range(n_sims):
            if verbose:
                print(f"sim {i}")

            # Their y-axis is flipped relative to mine, so start at (8,15), goal at (8,1)
            path, construal, data = jit.AStarRolloutStraight.construe_one(
                (start_goal_pos[0][0], maze_size-start_goal_pos[0][1]),   # rollout start in JIT notation
                (start_goal_pos[1][0], maze_size-start_goal_pos[1][1]),   # rollout goal in JIT notation
                g,
                set(),
                pars
            )

            paths.append(path)
            construals.append(construal)

            for j, v in enumerate(data[-1]["construal_traces"]):
                probs[j] += v / n_sims

        # Convert to my notation---start from (8,1), end at (8,15)
        paths = [[(tup[0],maze_size-tup[1]) for tup in path] for path in paths]

        occ = build_state_occupancy_map(
            paths,
            maze_shape=maze_arr.shape,
            xy_to_rc=xy_to_rc,
            binary_per_rollout=binary_per_rollout
        )

        prob_map = build_obstacle_prob_map(parsed_maze, probs)

        return {
            "maze_arr": maze_arr,
            "parsed_maze": parsed_maze,
            "g": g,
            "paths": paths,
            "construals": construals,
            "probs": probs,
            "occ": occ,
            "prob_map": prob_map,
        }


    def run_jit_across_mazes_and_plot(
        test_mazes,
        start_goal_pos,
        pars,
        n_sims=10,
        seed=0,
        xy_to_rc=True,
        binary_per_rollout=False,
        figsize_per_maze=(4.5, 4.5),
        shared_colorbars=True,
        verbose=False,
        plot_figure=False,
    ):
        """
        Run JIT on all mazes and create a 3 x n_mazes panel.

        Rows:
          0 -> raw maze
          1 -> state occupancy heatmap
          2 -> obstacle probability heatmap

        Parameters
        ----------
        test_mazes : list
            List of mazes in original string-list format
        start_goal_pos : tuple/list
            [(start_row, start_col), (goal_row, goal_col)]
        pars : jit.AStarPars
        n_sims : int
        seed : int
        xy_to_rc : bool
        binary_per_rollout : bool
        figsize_per_maze : tuple
            (width_per_col, height_per_row-ish scaling)
        shared_colorbars : bool
            If True, share scales across mazes for occupancy and prob maps
        verbose : bool

        Returns
        -------
        fig, ax, results
            results is a list of dicts, one per maze
        """
        n_mazes = len(test_mazes)
        results = []

        # -------------------------
        # Run all mazes first
        # -------------------------
        for maze_idx, test_maze in enumerate(test_mazes):
            if verbose:
                print(f"Running maze {maze_idx}/{n_mazes - 1}")

            result = run_jit_on_single_maze(
                test_maze=test_maze,
                start_goal_pos=start_goal_pos,
                pars=pars,
                n_sims=n_sims,
                seed=seed,
                xy_to_rc=xy_to_rc,
                binary_per_rollout=binary_per_rollout,
                verbose=False,
            )
            result["maze_idx"] = maze_idx
            results.append(result)

        # -------------------------
        # Shared scales
        # -------------------------
        if shared_colorbars:
            occ_vmax = max(np.max(res["occ"]) for res in results) if results else 1
            prob_vmax = max(np.nanmax(res["prob_map"]) for res in results) if results else 1
        else:
            occ_vmax = None
            prob_vmax = None

        # -------------------------
        # Plot
        # -------------------------
        if(plot_figure):
            fig, ax = plt.subplots(
                3,
                n_mazes,
                figsize=(figsize_per_maze[0] * n_mazes, figsize_per_maze[1] * 3),
                constrained_layout=True
            )

            if n_mazes == 1:
                ax = np.array(ax).reshape(3, 1)

            occ_last = None
            prob_last = None

            for col_idx, res in enumerate(results):
                maze_arr = res["maze_arr"]
                occ = res["occ"]
                prob_map = res["prob_map"]
                maze_shape = maze_arr.shape

                # -------------------------
                # Row 1: raw maze
                # -------------------------
                ax0 = ax[0, col_idx]
                maze_bg = build_original_maze_bg(maze_arr)
                ax0.imshow(maze_bg, cmap="gray", origin="upper", interpolation="nearest")
                ax0.set_title(f"Maze {res['maze_idx']}")

                sr, sc = start_goal_pos[0]
                gr, gc = start_goal_pos[1]
                ax0.plot(sr, sc, 'ro', markersize=10)
                ax0.plot(gr, gc, 'r*', markersize=10)

                ax0.set_xticks(np.arange(-0.5, maze_shape[1], 1), minor=True)
                ax0.set_yticks(np.arange(-0.5, maze_shape[0], 1), minor=True)
                ax0.grid(which="minor", color="lightgray", linestyle="-", linewidth=0.4)
                ax0.tick_params(which='both', bottom=False, left=False, labelbottom=False, labelleft=False)

                if col_idx == 0:
                    ax0.set_ylabel("Maze", fontsize=12)

                # -------------------------
                # Row 2: occupancy heatmap
                # -------------------------
                ax1 = ax[1, col_idx]
                if shared_colorbars:
                    occ_last = ax1.imshow(
                        occ, cmap="hot", origin="upper", interpolation="nearest",
                        vmin=0, vmax=occ_vmax
                    )
                else:
                    occ_last = ax1.imshow(
                        occ, cmap="hot", origin="upper", interpolation="nearest"
                    )

                ax1.plot(sr, sc, 'ro', markersize=10)
                ax1.plot(gr, gc, 'r*', markersize=10)

                ax1.set_xticks(np.arange(-0.5, maze_shape[1], 1), minor=True)
                ax1.set_yticks(np.arange(-0.5, maze_shape[0], 1), minor=True)
                ax1.grid(which="minor", color="lightgray", linestyle="-", linewidth=0.4)
                ax1.tick_params(which='both', bottom=False, left=False, labelbottom=False, labelleft=False)

                if col_idx == 0:
                    ax1.set_ylabel("Occupancy", fontsize=12)

                if not shared_colorbars:
                    cbar = fig.colorbar(occ_last, ax=ax1, shrink=0.8, pad=0.02)
                    cbar.set_label("Visit count" if not binary_per_rollout else "Visited in rollout")

                # -------------------------
                # Row 3: obstacle probs
                # -------------------------
                ax2 = ax[2, col_idx]

                # white background under NaNs
                bg = np.ones(maze_shape, dtype=float)
                ax2.imshow(bg, cmap="gray", origin="upper", interpolation="nearest", vmin=0, vmax=1)

                if shared_colorbars:
                    prob_last = ax2.imshow(
                        prob_map, cmap="Greys", origin="upper", interpolation="nearest",
                        vmin=0, vmax=prob_vmax
                    )
                else:
                    prob_last = ax2.imshow(
                        prob_map, cmap="Greys", origin="upper", interpolation="nearest"
                    )

                ax2.plot(sr, sc, 'ro', markersize=10)
                ax2.plot(gr, gc, 'r*', markersize=10)

                ax2.set_xticks(np.arange(-0.5, maze_shape[1], 1), minor=True)
                ax2.set_yticks(np.arange(-0.5, maze_shape[0], 1), minor=True)
                ax2.grid(which="minor", color="lightgray", linestyle="-", linewidth=0.4)
                ax2.tick_params(which='both', bottom=False, left=False, labelbottom=False, labelleft=False)

                if col_idx == 0:
                    ax2.set_ylabel("Obstacle\nprob.", fontsize=12)

                if not shared_colorbars:
                    cbar = fig.colorbar(prob_last, ax=ax2, shrink=0.8, pad=0.02)
                    cbar.set_label("P(obstacle in construal)")

            # Shared colorbars
            if shared_colorbars and n_mazes > 0:
                cbar1 = fig.colorbar(occ_last, ax=ax[1, :], shrink=0.85, pad=0.01)
                cbar1.set_label("Visit count" if not binary_per_rollout else "Visited in rollout")

                cbar2 = fig.colorbar(prob_last, ax=ax[2, :], shrink=0.85, pad=0.01)
                cbar2.set_label("P(obstacle in construal)")

            fig.suptitle(pars)

        return results

    n_param_grid = 20
    alpha_ds = np.linspace(0.0, 4, n_param_grid)
    alpha_hs = np.linspace(-1.0, 4, n_param_grid)
    # Generate all combinations (Cartesian product)
    combinations_iterator = itertools.product(alpha_ds, alpha_hs)
    # Convert the iterator to a list of tuples
    param_combinations = list(combinations_iterator)

    decay = 0
    alpha_d = param_combinations[param_sim_idx][0]
    alpha_h = param_combinations[param_sim_idx][1]
    print(alpha_d, alpha_h, decay)
    pars = jit.AStarPars(alpha_d, alpha_h, decay, False)

    results = run_jit_across_mazes_and_plot(
        test_mazes=test_mazes[0:15],
        start_goal_pos=start_goal_pos,
        pars=pars,
        n_sims=n_sims,
        seed=0,
        xy_to_rc=True,
        binary_per_rollout=False,
        figsize_per_maze=(4.2, 3.8),
        shared_colorbars=True,
        verbose=True,
        plot_figure=False
    )
    results_all = {"results": results}
    results_all["alpha_d"] = alpha_d
    results_all["alpha_h"] = alpha_h
    results_all["decay"] = decay
    results_all["n_sims"] = n_sims
    results_all["param_sim_idx"] = param_sim_idx
    results_all["seed"] = seed
    with open(os.path.join("solution_driven","model_preds","jit_param_sim_"+str(param_sim_idx)+".pkl"), 'wb') as file:
        pickle.dump(results_all, file)
jit_simulation_helper(param_sim_idx, n_sims, seed)