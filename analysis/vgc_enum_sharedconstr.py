import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--maze_idx", type=int, default=0, help="Which colored maze to run VGC on")
parser.add_argument("--seed", type=int, default=0, help="Seed for stochastic A*")
args = parser.parse_args()

# Dataset extraction
maze_idx = args.maze_idx
seed = args.seed


def vgc_simulation_helper(maze_idx=0, seed=0):
    

    import json
    import random
    from itertools import product
    import pickle
    import os

    import tqdm
    import numpy as np
    import pandas as pd
    import seaborn as sns
    import matplotlib.pyplot as plt
    import pickle

    from vgc_project.construal_search_new import \
        ConstrualSearch, ExhaustiveSearch, BreadthFirstSearch, DepthFirstSearch, \
        EventListener, BoundedDepthFirstSearch


    def xy_to_rowcol(maze, x, y):
        """
        Convert Cartesian-style maze coordinates:
            (0,0) = bottom-left
        into Python maze indexing:
            maze[row][col], with row 0 = top
        """
        H = len(maze)
        W = len(maze[0])
        if not (0 <= x < W and 0 <= y < H):
            return None
        row = H - 1 - y
        col = x
        return row, col


    def rowcol_to_xy(maze, row, col):
        """
        Inverse of xy_to_rowcol.
        """
        H = len(maze)
        y = H - 1 - row
        x = col
        return x, y


    def is_traversable(maze, x, y):
        rc = xy_to_rowcol(maze, x, y)
        if rc is None:
            return False
        row, col = rc
        return maze[row][col] in {'.', 'S', 'G'}


    def find_char(maze, target):
        """
        Find S or G in the maze and return Cartesian coordinates
        with bottom-left = (0,0).
        """
        H = len(maze)
        for row, line in enumerate(maze):
            for col, ch in enumerate(line):
                if ch == target:
                    return rowcol_to_xy(maze, row, col)
        raise ValueError(f"{target} not found in maze")
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
        wall_start_idx=1,
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

    def tabular_policy_to_dict(policy):
        states = policy.table_index.fields[0].domain
        actions = policy.table_index.fields[1].domain
        data = np.asarray(policy)

        policy_dict = {}
        for i, s in enumerate(states):
            state_xy = (int(s["x"]), int(s["y"]))
            policy_dict[state_xy] = {
                (int(a["dx"]), int(a["dy"])): float(data[i, j])
                for j, a in enumerate(actions)
            }
        return policy_dict


    def path_eval_success(path, maze):
        for loc in path:
            if not is_traversable(maze, loc[0], loc[1]):
                return False
        return True

    def rollout_greedy_policy(policy_dict, maze, start, goal=None, max_steps=200):
        path = [start]
        current = start
        visited = {start}
        success = False

        for _ in range(max_steps):
            if goal is not None and current == goal:
                break

            if current not in policy_dict:
                print(f"State {current} not in policy.")
                break

            action_probs = policy_dict[current]
            best_action = max(action_probs.items(), key=lambda kv: kv[1])[0]
            dx, dy = best_action

            nx = current[0] + dx
            ny = current[1] + dy

            if not is_traversable(maze, nx, ny):
                print(f"Policy tries to move into wall/out-of-bounds at {(nx, ny)}. Stopping.")
                break

            current = (nx, ny)
            path.append(current)

            if current in visited:
                print(f"Loop detected at {current}. Stopping.")
                break
            visited.add(current)

            if(nx==goal[0] and ny==goal[1]):
                success=True
                break

        return path, success


    # 1) Load colored mazes, with 12 chunked obstacles per maze for VGC to run.
    with open(os.path.join("solution_driven",'test_mazes_chunked.pkl'), 'rb') as file:
        mazes = pickle.load(file)



    sims = []
    rng = random.Random(seed)
    # for Ho et al. (8 obstacles at most), iter=1000>2^8 is already enough to traverse over the power set. But for us, need 2^12 = 4096. 
    max_iterations = 262244 #5000 #1000;
    runs = 1 # ExhaustiveSearch evaluates all construals, so no need for multiple simulations
    for \
        maze_name, \
        construal_value_threshold, \
        Strategy, \
        _ \
        in tqdm.tqdm(list(product(
            [list(mazes.keys())[maze_idx]],
            [-35],
            [ExhaustiveSearch],
            range(runs)
        ))):
        print(maze_name, Strategy)
        gw_params = dict(
            tile_array=tuple(mazes[maze_name]),
            feature_rewards=(("G", 0), ),
            absorbing_features=("G",),
            wall_features="abcdefghijklmnopqrstuvwxyz", #wall_features[maze_name], #"#0123456789"
            default_features=(".",),
            initial_features=("S",),
            step_cost=-1,
            discount_rate=.99
        )
        event_listener = EventListener()
        strategy = Strategy(
            gw_params=gw_params,
            max_iterations=max_iterations,
            construal_value_threshold=construal_value_threshold,
        )
        res = strategy.search(event_listener, rng=rng)

        # Find best path---and see if it is on rim
        policy_dict = tabular_policy_to_dict(res.cpi.policy)
        maze = mazes[maze_name]
        start = find_char(maze, 'S')
        goal = find_char(maze, 'G')
        best_path, _ = rollout_greedy_policy(policy_dict, maze, start=start, goal=goal, max_steps=200)
        sims.append(dict(
            **strategy.params(),
            construal_size=np.mean([len(c) for c in res.max_construals]),
            max_construal_size=max([len(c) for c in res.construal_values]),
            best_construal = res.max_construals,
            construal_utility=np.mean(list(res.max_construals_utilities.values())),
            maze_name=maze_name,
            construals_evaluated=len(res.construal_values),
            value=res.max_value,
            best_path = best_path,
            construals_bestpaths = res.construals_bestpaths,
        ))

        with open(os.path.join("solution_driven","model_preds","vgc_shared_"+str(maze_idx)+".pkl"), 'wb') as file:
            pickle.dump(res, file)

        sims = pd.DataFrame(sims)
        sims["path_length"] = -sims['construal_utility']
        sims['search_class'] = sims['search_class'].astype('category')
        sims.to_csv(os.path.join("solution_driven","model_preds","vgc_shared_"+str(maze_idx)+".csv"))

vgc_simulation_helper(maze_idx, seed)