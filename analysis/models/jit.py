#!/usr/bin/env python
# coding: utf-8

# %%


import json
import random
from dataclasses import dataclass
import multiprocessing as mp
import itertools as it
import math

import numpy as np
import matplotlib.pyplot as plt
import pandas as pd

# import heapq
# from scipy.stats import gumbel_r
from scipy.special import softmax

import joblib
from time import sleep

from models.mdps import GridWorld

np.set_printoptions(precision=3)  # Set precision to 3 decimal places


# %%




@dataclass
class AStarPars:
    alpha_d: float
    alpha_h: float
    decay: float = 0.0
    noise_floor: float = 0.0
    debug: bool = False


def update_construal(construal, intersections, step, construal_traces=None, decay=1.0):
    if construal_traces is not None:
        for i in construal:
            # construal_traces[i] = construal_traces[i] * ((1 + 1 / step) ** -decay)
            construal_traces[i] += 1

    for i in intersections:
        construal.add(i)
        if construal_traces is not None:
            construal_traces[i] = 1

# def update_construal(construal, intersections, step, construal_traces=None, decay=1.0, newobj_prob=1.0):
#     if construal_traces is not None:
#         for i in construal:
#             # exponential
#             # construal_traces[i] *= decay

#             # power law
#             construal_traces[i] = construal_traces[i] * ((1 + 1 / step) ** -decay)

#     for i in intersections:
#         construal.add(i)
#         if construal_traces is not None:
#             construal_traces[i] = newobj_prob


def astar(grid, start, goal, construal, alpha_d, alpha_h, heuristic, debug, dist_from_start):
    budget = 1000
    prev = {start: None}
    values = [heuristic(start)]
    heap = [(heuristic(start), 0, start)]
    visitations = []
    f = {start: 0}
    n_expanded = 0
    while n_expanded < budget:
        idx = random.choices(range(len(heap)), weights=softmax(-np.array(values)))[0]
        values.pop(idx)
        _, dist, node = heap.pop(idx)
        visitations.append((node, n_expanded))
        if node == goal:
            path = [node]
            while node != start:
                node = prev[node]
                path.append(node)
            return path[::-1], [(node, i / n_expanded) for node, i in visitations]

        for i, n in enumerate(grid.neighbors(node, construal)):
            if dist + 1 < f.get(n, float("inf")):
                if n not in f:
                    heap.append((heuristic(n), dist + 1, n))
                    start_dist = dist + 1
                    if dist_from_start:
                        start_dist = heuristic(n, (0, 0))
                    values.append(start_dist * alpha_d + heuristic(n) * alpha_h)
                f[n] = dist + 1
                prev[n] = node
        n_expanded += 1

    # return best plan so far
    _, _, node = heap.pop(random.choices(range(len(heap)), weights=softmax(-np.array(values)))[0])
    path = [node]
    while node != start:
        node = prev[node]
        path.append(node)
    return path[::-1], [(node, i / n_expanded) for node, i in visitations]


def shortcut(path, grid: GridWorld):
    if len(path) == 0:
        return []

    # takes in a path, and attempts to postprocess it to a shorter length
    # first, remove any backtracking
    path = path.copy()
    from collections import Counter

    while True:
        node_freq = Counter(path)
        # if node_freq.most_common(1) == 1:
        if all(v == 1 for v in node_freq.values()):
            break
        node = next(iter([node for node, v in node_freq.items() if v > 1]), None)
        start_idx = path.index(node)
        end_idx = len(path) - path[::-1].index(node) - 1
        path = path[:start_idx] + path[end_idx:]

    # greedy scan to find shortcuts
    idx = 0
    new_path = [path[0]]
    while idx < len(path) - 1:
        next_idx = idx + 1

        for lookahead in range(len(path) - 1, idx + 1, -1):
            node_curr = path[idx]
            node_next = path[lookahead]

            if node_curr[0] == node_next[0]:
                shortcut = [(node_curr[0], i) for i in range(node_curr[1] + 1, node_next[1])]
            elif node_curr[1] == node_next[1]:
                shortcut = [(i, node_curr[1]) for i in range(node_curr[0] + 1, node_next[0])]
            else:
                continue

            if any(any(s in o for o in grid.obstacles) for s in shortcut):
                continue
            new_path += shortcut
            next_idx = lookahead
            break

        new_path.append(path[next_idx])
        idx = next_idx

    return new_path


class AStarRollout:
    @classmethod
    def make_param_iter(cls, fix=None):
        if "decay" in fix:
            decays = [0.0]
        else:
            decays = np.logspace(-1, 0.4, 20)

        if "floor" in fix:
            noise_floors = [0.0]
        else:
            noise_floors = [0, 0.05, 1]

        alpha_ds = np.linspace(0.0, 4, 20)
        alpha_hs = np.linspace(-1.0, 4, 20)

        return it.product(alpha_ds, alpha_hs, decays, noise_floors)

    @classmethod
    def fit_parameters(cls, data, n_iter, response_column, param_iter):
        print("starting parameter fitting")

        with mp.Pool() as pool:
            r2s = pool.starmap(
                cls.compute_r2,
                [
                    (data, alpha_d, alpha_h, decay, noise_floor, n_iter, response_column)
                    for alpha_d, alpha_h, decay, noise_floor in param_iter
                ]
            )

        return pd.DataFrame(r2s, columns=["alpha_d", "alpha_h", "decay", "noise_floor", "r2"])

    @classmethod
    def predict(cls, pars: AStarPars, grids, n_iter):
        _jit = []
        for m in grids:
            print(m)
            gridstr = maze[f"grid-{m}"]
            c = cls.batch_construe(gridstr, pars, n_iter=n_iter)

            for obj, prob in c.items():
                _jit.append((int(m), int(obj), prob / n_iter))
        return pd.DataFrame(_jit, columns=["grid", "probeobs", "prob"])

    @classmethod
    def combine(cls, human_data, model_data):
        return pd.merge(
            human_data,
            model_data,
            on=["grid", "probeobs"],
        )

    @classmethod
    def compute_r2(cls, dataset, alpha_d, alpha_h, decay, noise_floor, n_iter, response_column):
        pars = AStarPars(alpha_d, alpha_h, decay, noise_floor, False)
        _jit = cls.predict(pars, dataset.grid.unique(), n_iter=n_iter)
        tmp = pd.merge(
            dataset.groupby(["grid", "probeobs"])[response_column].mean().reset_index(),
            _jit,
            on=["grid", "probeobs"],
        )
        return alpha_d, alpha_h, decay, noise_floor, tmp.prob.corr(tmp[response_column]) ** 2

    @classmethod
    def batch_construe(cls, gridstr, pars: AStarPars, n_iter=100):
        D = len(gridstr)
        grid = GridWorld.from_string(gridstr)
        obj_probs = {n: 0 for n in grid.obstacle_names}
        for _ in range(n_iter):
            startidx = "".join(reversed(gridstr)).index("S")
            goalidx = "".join(reversed(gridstr)).index("G")
            start = (startidx % D, startidx // D)
            goal = (goalidx % D, goalidx // D)
            grid = GridWorld.from_string(gridstr)

            _, construal, data = cls.construe_one(
                start,
                goal,
                grid,
                init_construal={grid.obstacle_names.index("#")},
                pars=pars,
            )
            # for i in construal:
            for i in range(len(grid.obstacles)):
                if i in construal:
                    obj_probs[grid.obstacle_names[i]] += (1 - pars.noise_floor) * data[-1][
                        "construal_traces"
                    ][i] + pars.noise_floor
                else:
                    obj_probs[grid.obstacle_names[i]] += pars.noise_floor

        del obj_probs["#"]
        return obj_probs

    @classmethod
    def construe_one(
        cls,
        start: tuple,
        goal: tuple,
        grid: GridWorld,
        init_construal: set,
        pars: AStarPars,
        backtrack=True,
    ):
        alpha_d, alpha_h, decay, debug = (
            pars.alpha_d,
            pars.alpha_h,
            pars.decay,
            pars.debug,
        )
        heuristic = grid.manhattan

        construal = init_construal.copy()  # list of indices of obstacles
        steps_since_flagged = [0] * len(grid.obstacles)
        for i in construal:
            steps_since_flagged[i] = 1

        steps = 0
        path = []
        node = start
        # data = {"proposed plans": [], "construal_traces": []}
        data = [
            {
                "visitations": [],
                "proposed plans": [],
                "construal_traces": [0 if i not in construal else 1 for i in range(len(grid.obstacles))],
                "steps_since_flagged": steps_since_flagged.copy(),
                "construal": construal.copy(),
                "working_construal": construal.copy(),
            }
        ]
        while node != goal and steps < 200:
            steps += 1

            data_item = {}
            working_construal = set(
                i
                for i, trace in zip(range(len(grid.obstacles)), data[-1]["construal_traces"])
                if random.random() < trace
            )
            working_construal |= init_construal
            # backtrack=False
            proposed_plan, visitations = astar(
                grid,
                node,
                goal,
                working_construal,
                alpha_d,
                alpha_h,
                heuristic,
                debug,
                backtrack,
            )
            data_item["working_construal"] = working_construal.copy()
            # proposed_plan = astar(grid, start, goal, construal, alpha_d, alpha_h, heuristic, debug, backtrack)
            data_item["visitations"] = visitations
            data_item["proposed plans"] = proposed_plan
            for node, proposed in zip(proposed_plan[:-1], proposed_plan[1:]):
                path.append(node)
                is_valid, intersections = grid.check_collision_construal(proposed)
                if not is_valid:
                    if debug:
                        print(f"not valid, error transitioning from {node} -> {proposed}")
                    update_construal(
                        construal,
                        intersections,
                        steps,
                        construal_traces=steps_since_flagged,
                        decay=decay,
                    )
                    break
            else:
                node = proposed
            # data_item["construal_traces"] = construal_traces.copy()
            data_item["construal_traces"] = [(1 / steps) ** (decay) if steps > 0 else 0 for steps in steps_since_flagged]
            data_item["steps_since_flagged"] = steps_since_flagged.copy()
            data_item["construal"] = construal.copy()
            data.append(data_item)

        # data["construal_traces"].append(construal_traces.copy())
        return path, construal, data

class AStarRolloutNoFloor(AStarRollout):
    @classmethod
    def make_param_iter(cls):
        decays = np.logspace(-1, 0.4, 20)
        alpha_ds = np.linspace(0.0, 4, 20)
        alpha_hs = np.linspace(-1.0, 4, 20)

        return it.product(alpha_ds, alpha_hs, decays)

    @classmethod
    def fit_parameters(cls, data, n_iter, response_column, param_iter):
        print("starting parameter fitting")

        with mp.Pool() as pool:
            r2s = pool.starmap(
                cls.compute_r2,
                [
                    (data, alpha_d, alpha_h, decay, n_iter, response_column)
                    for alpha_d, alpha_h, decay in param_iter
                ]
            )

        return pd.DataFrame(r2s, columns=["alpha_d", "alpha_h", "decay", "r2"])

    @classmethod
    def compute_r2(cls, dataset, alpha_d, alpha_h, decay, n_iter, response_column):
        *_, r2 = super().compute_r2(dataset, alpha_d, alpha_h, decay, 0, n_iter, response_column)
        return alpha_d, alpha_h, decay, r2

    @classmethod
    def predict(cls, pars: AStarPars, data, n_iter):
        assert pars.noise_floor <= 0.0001

        return super().predict(pars, data, n_iter)


class AStarNoDecay(AStarRollout):
    @classmethod
    def fit_parameters(cls, data, n_iter, response_column):
        print("starting parameter fitting")

        r2s = []
        with mp.Pool() as pool:
            _r2s = pool.starmap(
                AStarNoDecay.compute_r2,
                [
                    (data, alpha_d, alpha_h, n_iter, response_column)
                    for alpha_d in np.linspace(0.0, 4, 20)
                    for alpha_h in np.linspace(0.0, 4, 20)
                ],
            )
            r2s.extend(_r2s)

        return pd.DataFrame(r2s, columns=["alpha_d", "alpha_h", "r2"])

    @classmethod
    def predict(cls, pars: AStarPars, data, n_iter):
        assert pars.decay >= 0.99999

        _jit = []
        for m in data.grid.unique():
            print(m)
            gridstr = maze[f"grid-{m}"]
            c = AStarRollout.batch_construe(gridstr, pars, n_iter=n_iter)

            for obj, prob in c.items():
                _jit.append((int(m), int(obj), prob / n_iter))
        return pd.DataFrame(_jit, columns=["grid", "probeobs", "prob"])

    @classmethod
    def compute_r2(cls, dataset, alpha_d, alpha_h, n_iter, response_column):
        pars = AStarPars(alpha_d, alpha_h, 1.0, False)
        _jit = AStarRollout.predict(pars, dataset, n_iter=n_iter)
        tmp = pd.merge(
            dataset.groupby(["grid", "probeobs"])[response_column].mean().reset_index(),
            _jit,
            on=["grid", "probeobs"],
        )
        return alpha_d, alpha_h, tmp.prob.corr(tmp[response_column]) ** 2

def astar_straight(
    grid, start, goal, construal, alpha_d, alpha_h, heuristic, debug, backtrack=False
):
    # A*, but tie-break paths based on the path with fewer "turns"
    budget = 500
    prev = {start: None}
    values = [heuristic(start)]
    heap = [(heuristic(start), 0, start)]
    f = {start: 0}

    n_expanded = 0
    visitations = []
    while n_expanded < budget:
        idx = random.choices(range(len(heap)), weights=softmax(-np.array(values)))[0]
        values.pop(idx)
        _, dist, node = heap.pop(idx)
        visitations.append((node, n_expanded))
        if node == goal:
            direction = None
            path = [node]
            while node != start:
                if not direction:
                    node = random.choice(list(prev[node]))
                    direction = (node[0] - path[-1][0], node[1] - path[-1][1])
                else:
                    node = min(
                        prev[node],
                        key=lambda x: 0 if (x[0] - node[0], x[1] - node[1]) == direction else 1
                    )
                    direction = (node[0] - path[-1][0], node[1] - path[-1][1])
                    # node = prev[node]
                path.append(node)
            return path[::-1], [(n, v / n_expanded) for n, v in visitations]

        for i, n in enumerate(grid.neighbors(node, construal)):
            if dist + 1 <= f.get(n, float("inf")):
                if n not in f:
                    heap.append((heuristic(n), dist + 1, n))
                    start_dist = dist + 1
                    # start_dist = heuristic(n, start)
                    if backtrack:
                        start_dist = heuristic(n, (0, 0))
                    values.append(start_dist * alpha_d + heuristic(n) * alpha_h)
                f[n] = dist + 1
                # prev[n] = node
                prev.setdefault(n, set()).add(node)
        n_expanded += 1

    raise Exception("no plan found")

class AStarRolloutStraight(AStarRolloutNoFloor):
    # out of date
    @classmethod
    def make_param_iter(cls, fix):
        if "decay" in fix:
            decays = [0.0]
        else:
            decays = np.logspace(-1, 0.4, 20)

        alpha_ds = np.linspace(0.0, 4, 20)
        alpha_hs = np.linspace(-1.0, 4, 20)

        return it.product(alpha_ds, alpha_hs, decays)

    @classmethod
    def construe_one(
        cls,
        start: tuple,
        goal: tuple,
        grid: GridWorld,
        init_construal: set,
        pars: AStarPars,
    ):
        alpha_d, alpha_h, decay, debug = (
            pars.alpha_d,
            pars.alpha_h,
            pars.decay,
            pars.debug
        )
        heuristic = grid.manhattan

        construal = init_construal.copy()  # list of indices of obstacles
        steps_since_flagged = [0] * len(grid.obstacles)
        for i in construal:
            steps_since_flagged[i] = 1

        steps = 0
        path = []
        node = start
        # data = {"proposed plans": [], "construal_traces": []}
        data = [
            {
                "visitations": [],
                "proposed plans": [],
                "construal_traces": [0 if i not in construal else 1 for i in range(len(grid.obstacles))],
                "steps_since_flagged": steps_since_flagged.copy(),
                "construal": construal.copy(),
                "working_construal": construal.copy(),
            }
        ]
        while node != goal and steps < 200:
            steps += 1

            data_item = {}
            working_construal = set(
                i
                for i, trace in zip(range(len(grid.obstacles)), data[-1]["construal_traces"])
                if random.random() < trace
            )
            working_construal |= init_construal
            proposed_plan, visitations = astar_straight(
                grid,
                node,
                goal,
                working_construal,
                alpha_d,
                alpha_h,
                heuristic,
                debug,
                backtrack=False
            )
            data_item["working_construal"] = working_construal.copy()
            # proposed_plan = astar(grid, start, goal, construal, alpha_d, alpha_h, heuristic, debug, backtrack)
            data_item["visitations"] = visitations
            data_item["proposed plans"] = proposed_plan
            for node, proposed in zip(proposed_plan[:-1], proposed_plan[1:]):
                path.append(node)
                is_valid, intersections = grid.check_collision_construal(proposed)
                if not is_valid:
                    if debug:
                        print(f"not valid, error transitioning from {node} -> {proposed}")
                    update_construal(
                        construal,
                        intersections,
                        steps,
                        construal_traces=steps_since_flagged,
                        decay=decay,
                    )
                    break
            else:
                node = proposed
            data_item["construal_traces"] = [(1 / steps) ** decay if steps > 0 else 0 for steps in steps_since_flagged]
            data_item["steps_since_flagged"] = steps_since_flagged.copy()
            data_item["construal"] = construal.copy()
            data.append(data_item)

        # data["construal_traces"].append(construal_traces.copy())
        return path, construal, data

# ==== OLD ====

# @cache.cache
def q_iteration(w, h, goal, obstacles, discount, motor_noise, collision_cost, rtol, debug):
    grid = GridWorld(
        w,
        h,
        goal,
        obstacles,
        discount=discount,
        error_prob=motor_noise,
        collision_cost=collision_cost,
    )
    # Q = {(s, a): -(abs(s[0] - goal[0]) + abs(s[1] - goal[1])) for s in grid.states for a in grid.actions}
    Q = {s: dict() for s in grid.states}
    for s in Q:
        manhattan = abs(s[0] - goal[0]) + abs(s[1] - goal[1])
        for a in grid.actions:
            Q[s][a] = -manhattan

    i = 0
    while i < 100:
        delta = 0
        for state in grid.states:
            for action in grid.actions:
                # if state == grid.goal:
                #     continue
                # if state in grid.obstacles[construal]:
                #     continue

                old_value = Q[state][action]
                Q[state][action] = sum(
                    grid.reward(state, action, n)
                    + grid.discount * p * max(Q[n][a] for a in grid.actions)
                    for n, p in grid.transition(state, action)
                )
                delta = max(delta, abs(old_value - Q[state][action]))

        i += 1
        if delta < rtol:
            if debug:
                print(f"converged after {i} iterations")
            break

    return Q


# @cache.cache
cache = joblib.Memory("_cache", verbose=0)


@cache.cache
def q_iteration_direction(
    w,
    h,
    goal,
    obstacles,
    discount,
    motor_noise,
    switch_cost,
    collision_cost,
    rtol,
    debug,
):
    # add a direction to the gridworld states. it's more costly to change direction
    grid = GridWorld(
        w,
        h,
        goal,
        obstacles,
        discount=discount,
        error_prob=motor_noise,
        collision_cost=collision_cost,
    )
    states = []
    for state in grid.states:
        states.extend([(state, d) for d in range(4)])  # up right down left

    action_to_direction = {
        (0, 1): 0,
        (1, 0): 1,
        (0, -1): 2,
        (-1, 0): 3,
    }

    def transition(s, a):
        for n, p in grid.transition(s[0], a):
            new_direction = action_to_direction[a]
            yield (n, new_direction), p

    def reward(s, a, s_):
        r = grid.reward(s[0], a, s_[0])
        return r + (-switch_cost if s[1] != action_to_direction[a] else 0.0)

    # Q = {(s, a): -(abs(s[0] - goal[0]) + abs(s[1] - goal[1])) for s in grid.states for a in grid.actions}
    Q = {s: dict() for s in states}
    for s in Q:
        manhattan = abs(s[0][0] - goal[0]) + abs(s[0][1] - goal[1])
        for a in grid.actions:
            Q[s][a] = -manhattan

    i = 0
    while i < 100:
        delta = 0
        for state in states:
            for action in grid.actions:
                # if state == grid.goal:
                #     continue
                # if state in grid.obstacles[construal]:
                #     continue

                old_value = Q[state][action]
                Q[state][action] = sum(
                    p
                    * (
                        reward(state, action, n)
                        + grid.discount * max(Q[n][a] for a in grid.actions)
                    )
                    for n, p in transition(state, action)
                )
                delta = max(delta, abs(old_value - Q[state][action]))

        i += 1
        if delta < rtol:
            if debug:
                print(f"converged after {i} iterations")
            break

    return Q


@dataclass
class PolicyPars:
    rollout_alpha: float
    alpha: float
    motor_noise: float
    switching_cost: float
    collision_cost: float
    decay: float
    n_iter: int = 200
    debug: bool = False


class PolicyRollout:
    # out of date
    @classmethod
    def fit_parameters(self, data, n_iter, response_column, out_file, ckpt_index=0):
        def parameter_iterator(start_idx):
            iterator = it.product(
                np.linspace(0.0, 5.0, 20),
                np.linspace(0.0, 0.5, 10),
                np.linspace(0.0, 2.0, 20),
                np.linspace(0.5, 1.0, 10),
            )
            iterator = it.islice(iterator, start_idx, None, 1)
            for i, (alpha, motor_noise, switching_cost, decay) in enumerate(iterator):
                yield i, alpha, motor_noise, switching_cost, decay

        q = mp.Manager().Queue()
        print("starting parameter fitting")

        # start csv writer task
        worker = mp.Process(target=PolicyRollout.csv_worker, args=(q, out_file))
        worker.start()

        with mp.Pool() as pool:
            pool.starmap(
                PolicyRollout.compute_r2,
                [
                    (
                        q,
                        data,
                        alpha,
                        motor_noise,
                        switching_cost,
                        decay,
                        n_iter,
                        response_column,
                        i,
                    )
                    for i, alpha, motor_noise, switching_cost, decay in parameter_iterator(
                        ckpt_index
                    )
                ],
            )
        q.put(None)
        worker.join()
        return pd.read_csv(out_file)

    @classmethod
    def predict(cls, pars, data):
        _jit = []
        for m in data.grid.unique():
            print(m)
            gridstr = maze[f"grid-{m}"]
            c = PolicyRollout.batch_construe(gridstr, pars)

            for obj, prob in c.items():
                _jit.append((int(m), int(obj), prob / pars.n_iter))
        return pd.DataFrame(_jit, columns=["grid", "probeobs", "prob"])

    @classmethod
    def combine(cls, human_data, model_data):
        return pd.merge(
            human_data,
            model_data,
            on=["grid", "probeobs"],
        )

    @classmethod
    def compute_r2(
        cls,
        q,
        dataset,
        alpha,
        motor_noise,
        switching_cost,
        decay,
        n_iter,
        response_column,
        i,
    ):
        pars = PolicyPars(4, alpha, motor_noise, switching_cost, 3.0, decay, n_iter)
        _jit = PolicyRollout.predict(pars, dataset)
        tmp = pd.merge(
            dataset.groupby(["grid", "probeobs"])[response_column].mean().reset_index(),
            _jit,
            on=["grid", "probeobs"],
        )
        q.put(
            i,
            alpha,
            motor_noise,
            switching_cost,
            decay,
            tmp.prob.corr(tmp[response_column]) ** 2,
        )
        # pars = AStarPars(alpha_d, alpha_h, decay, False)
        # _jit = PolicyRollout.predict(pars, dataset, n_iter=n_iter)
        # tmp = pd.merge(
        #     dataset.groupby(["grid", "probeobs"])[response_column].mean().reset_index(),
        #     _jit,
        #     on=["grid", "probeobs"],
        # )
        # return alpha_d, alpha_h, decay, tmp.prob.corr(tmp[response_column]) ** 2

    @classmethod
    def batch_construe(cls, gridstr, pars):
        D = len(gridstr)
        grid = GridWorld.from_string(gridstr)
        obj_probs = {n: 0 for n in grid.obstacle_names}

        importance_normalizer = 0
        for _ in range(pars.n_iter):
            startidx = "".join(reversed(gridstr)).index("S")
            goalidx = "".join(reversed(gridstr)).index("G")
            start = (startidx % D, startidx // D)
            goal = (goalidx % D, goalidx // D)
            grid = GridWorld.from_string(gridstr)

            _, construal, data = PolicyRollout.construe_one(
                start,
                goal,
                grid,
                init_construal={grid.obstacle_names.index("#")},
                pars=pars,
            )
            iw = math.exp(data[-1]["importance_weight"])
            importance_normalizer += iw
            for i in construal:
                obj_probs[grid.obstacle_names[i]] += data[-1]["construal_trace"][i] * iw
        del obj_probs["#"]
        return {k: v / importance_normalizer for k, v in obj_probs.items()}

    @classmethod
    def construe_one(
        cls,
        start: tuple,
        goal: tuple,
        grid: GridWorld,
        init_construal: set,
        pars: PolicyPars,
    ):
        (
            rollout_alpha,
            alpha,
            motor_noise,
            switching_cost,
            collision_cost,
            decay,
            debug,
        ) = (
            pars.rollout_alpha,
            pars.alpha,
            pars.motor_noise,
            pars.switching_cost,
            pars.collision_cost,
            pars.decay,
            pars.debug,
        )
        # heuristic = grid.manhattan

        construal = init_construal  # list of indices of obstacles
        construal_traces = [0] * len(grid.obstacles)
        for i in construal:
            construal_traces[i] = 1

        trace = []

        # randomly face right or up
        node = (start, 0 if random.random() < 0.5 else 1)
        total_path = []

        importance_weight = 0
        for step in range(20):
            # Q = q_iteration(
            #     grid.width,
            #     grid.height,
            #     goal,
            #     [grid.obstacles[i] for i in construal],
            #     0.99,
            #     motor_noise,
            #     1e-3,
            #     debug,
            # )
            Q = q_iteration_direction(
                grid.width,
                grid.height,
                goal,
                [grid.obstacles[i] for i in construal],
                0.99,
                motor_noise,
                switching_cost,
                collision_cost,
                1e-3,
                debug,
            )
            # print(Q[((0, 10), 1)])
            action_to_direction = {
                (0, 1): 0,
                (1, 0): 1,
                (0, -1): 2,
                (-1, 0): 3,
            }

            path = []
            while node[0] != goal:
                if debug:
                    print("current state:")
                    gridstr = grid.to_strings()
                    gridstr[node[0][1]][node[0][0]] = "O"  # mark current position
                    print("\n".join("".join(row) for row in reversed(gridstr)))
                    sleep(0.5)
                    print("--" * 50)

                path.append(node)

                rollout_policy = softmax(
                    np.array([Q[node][a] for a in grid.actions]) * rollout_alpha
                )
                scoring_policy = softmax(np.array([Q[node][a] for a in grid.actions]) * alpha)
                if debug:
                    print("rollout policy:", rollout_policy)
                    print("scoring policy:", scoring_policy)
                a_proposed = np.random.choice(range(len(grid.actions)), p=rollout_policy)
                action = grid.actions[a_proposed]
                # pa_proposed = rollout_policy[node][a_proposed]
                pa_proposed = rollout_policy[a_proposed]
                importance_weight += np.log(scoring_policy[a_proposed]) - np.log(pa_proposed)

                proposed = (
                    (node[0][0] + action[0], node[0][1] + action[1]),
                    action_to_direction[action],
                )
                if debug:
                    print("action proposed:", action, "->", proposed[0])

                is_valid, intersections = grid.check_collision_construal(proposed[0])
                if is_valid:
                    node = proposed
                elif not is_valid and intersections:
                    update_construal(
                        construal,
                        intersections,
                        step+1,
                        construal_traces=construal_traces,
                        decay=decay,
                        # newobj_prob=pa_proposed,
                    )
                    break

            trace.append(
                {
                    "path": path,
                    "importance_weight": importance_weight,
                    "construal_trace": construal_traces.copy(),
                    "Q": Q,
                }
            )
            total_path.extend(path)

            if node[0] == goal:
                break
        else:  # nobreak
            print("timed out")

        return total_path, construal, trace

    @classmethod
    def csv_worker(cls, q, filename):
        pd.DataFrame(
            columns=["idx", "alpha", "motor_noise", "switching_cost", "decay", "r2"]
        ).to_csv(filename, index=False)

        while True:
            result = q.get()

            if result is None:  # Sentinel value to signal stop
                break

            # Unpack and write the actual result
            # eval_loss, parameter_json = result
            df = pd.DataFrame(
                [result],
                columns=[
                    "idx",
                    "alpha",
                    "motor_noise",
                    "switching_cost",
                    "decay",
                    "r2",
                ],
            )
            # current_result = pd.DataFrame([[eval_loss, parameter_json]], columns=columns)
            df.to_csv(filename, mode="a", header=False)

    @classmethod
    def restart(cls, data, n_iter, response_column, out_file):
        result_df = pd.read_csv(out_file)
        max_idx = result_df.idx.max()
        cls.fit_parameters(data, n_iter, response_column, out_file, ckpt_index=max_idx)

