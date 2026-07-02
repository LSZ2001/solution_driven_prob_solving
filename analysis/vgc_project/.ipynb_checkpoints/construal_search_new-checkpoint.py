
from types import SimpleNamespace
import random
import numpy as np
from abc import ABC, abstractclassmethod
from collections import Counter
from vgc_project.construal_utils import create_gridworld, solve_gridworld, evaluate_construal, powerset

from frozendict import frozendict

from msdm.domains import GridWorld
from msdm.algorithms import PolicyIteration
from msdm.core.distributions import DictDistribution

            
class ConstrualSearch(ABC):
    def __init__(
        self, 
        gw_params,
        max_iterations,
        construal_value_threshold,
    ):
        self.gw_params = gw_params
        # effects_features = sorted(set(''.join(gw_params['tile_array'])) & set("012345678"))
        # self.effects_features = ''.join(effects_features)
        maze_symbols = set(''.join(gw_params['tile_array']))
        effects_features = sorted((set(gw_params['wall_features']) - {'#'}) & maze_symbols)
        self.effects_features = tuple(effects_features)
        self.max_iterations = max_iterations
        self.construal_value_threshold = construal_value_threshold
    
    @abstractclassmethod
    def initialize(self, rng) -> tuple:
        pass
    @abstractclassmethod
    def next_construal(self, c, construal_planner, rng) -> tuple:
        pass
    
    def params(self):
        return dict(
            max_iterations=self.max_iterations,
            construal_value_threshold=self.construal_value_threshold,
            instance_id=id(self),
            search_class=self.__class__.__name__
        )
    
    def make_construal_planner(self):
        """Returns a function that tracks unique planning calls"""
        results = {}
        def construal_planner(c):
            if c in results:
                return results[c]
            cgw_params = {**self.gw_params, 'wall_features':"#"+''.join(c)}
            cpi = solve_gridworld(cgw_params) #cacheable function
            results[c] = cpi
            return cpi
        construal_planner.results = results
        return construal_planner
    
    def search(self, event_listener=None, rng=random):
        gw = create_gridworld(self.gw_params)
        construal_planner = self.make_construal_planner()

        c = self.initialize(rng=rng)
        construal_values = {}
        for i in range(self.max_iterations):
            cpi = construal_planner(c)
            c_utility = evaluate_construal(c, self.gw_params).initial_value #cachable func
            construal_values[c] = c_utility - len(c)
            nc = self.next_construal(c, construal_planner, rng=rng)
            if event_listener:
                event_listener.construal_search_loop(locals())
            if construal_values[c] > self.construal_value_threshold:
                break
            if nc is None:
                break
            c = nc
        
        #assume that we do not re-compute construals
        assert i == len(construal_values) - 1 

        total_construal_cost = sum([len(c) for c in construal_planner.results.keys()])
        max_value = max(construal_values.values())
        max_construals = set(c for c, v in construal_values.items() if v == max_value)
        max_construals_utilities = {}
        for c in max_construals:
            max_construals_utilities[c] = evaluate_construal(c, self.gw_params).initial_value
        return SimpleNamespace(
            construal_values=construal_values,
            total_construal_cost=total_construal_cost,
            iterations=i,
            max_construals=max_construals,
            max_construals_utilities=max_construals_utilities,
            max_value=max_value,
            cpi=cpi
        )
    
class EventListener:
    def __init__(self):
        self.history = []
    def construal_search_loop(self, lv):
        step = dict(
            c=lv['c'],
            c_utility=lv['c_utility'],
            nc=lv['nc']
        )
        self.history.append(step)

from collections import deque
class ExhaustiveSearch(ConstrualSearch):
    def initialize(self, rng=random):
        pass
    def next_construal(self, c, construal_planner, rng=random):
        pass
    
    def tabular_policy_to_dict(self,policy):
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

    def rollout_greedy_policy(self,policy_dict, start, goal=None, max_steps=200):
        path = [start]
        current = start
        visited = {start}

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

            current = (nx, ny)
            path.append(current)

            if current in visited:
                #print(f"Loop detected at {current}. Stopping.")
                break
            visited.add(current)

        return path
    
    
    def search(self, event_listener=None, rng=random):
        gw = create_gridworld(self.gw_params)
        construal_planner = self.make_construal_planner()
        construal_values = {}
        construals_bestpaths = {}
        for i, c in enumerate(powerset(self.effects_features)):
            if(i%100==0):
                print(i,c)
            cpi = construal_planner(c) #just for counting
            c_utility = evaluate_construal(c, self.gw_params).initial_value #cachable func
            construal_values[c] = c_utility - len(c)
            
            # Find best path---and see if it is on rim
            policy_dict = self.tabular_policy_to_dict(cpi.policy)
            best_path = self.rollout_greedy_policy(policy_dict, start=(8,15), goal=(8,1), max_steps=200)
            construals_bestpaths[c] = best_path
    
        total_construal_cost = sum([len(c) for c in construal_planner.results.keys()])
        max_value = max(construal_values.values())
        max_construals = set(c for c, v in construal_values.items() if v == max_value)
        max_construals_utilities = {}
        for c in max_construals:
            max_construals_utilities[c] = evaluate_construal(c, self.gw_params).initial_value
        return SimpleNamespace(
            construal_values=construal_values,
            total_construal_cost=total_construal_cost,
            iterations=i,
            max_construals=max_construals,
            max_construals_utilities=max_construals_utilities,
            max_value=max_value,
            cpi=cpi,
            construals_bestpaths = construals_bestpaths,
        )
    
class BreadthFirstSearch(ConstrualSearch):
    def initialize(self, rng=random):
        self._queue = deque([])
        return ()
    def next_construal(self, c, construal_planner, rng=random):
        visited = set(construal_planner.results.keys())
        neighbors = [tuple(sorted(set(c) | {e})) for e in self.effects_features]
        neighbors = [nc for nc in neighbors if nc not in visited]
        self._queue.extend(sorted(list(neighbors), key=lambda e: rng.random()))
        # print(self._queue)
        while self._queue:
            nc = self._queue.popleft()
            if nc not in visited:
                return nc
        
class DepthFirstSearch(ConstrualSearch):
    def initialize(self, rng=random):
        self._stack = []
        return ()
    def next_construal(self, c, construal_planner, rng=random):
        visited = set(construal_planner.results.keys())
        neighbors = [tuple(sorted(set(c) | {e})) for e in self.effects_features]
        neighbors = [nc for nc in neighbors if nc not in visited]
        neighbors = sorted(neighbors, key = lambda nc: ''.join(sorted(nc)))
        self._stack.extend(sorted(list(neighbors), key=lambda e: rng.random()))
        while self._stack:
            nc = self._stack.pop()
            if nc not in visited:
                return nc
            
class BoundedDepthFirstSearch(ConstrualSearch):
    """
    Use DFS up to a fixed depth, and then do BFS.
    """
    bound = 3
    def initialize(self, rng=random):
        self._queue = deque([])
        return ()
    def next_construal(self, c, construal_planner, rng=random):
        visited = set(construal_planner.results.keys())
        neighbors = [tuple(sorted(set(c) | {e})) for e in self.effects_features]
        neighbors = [nc for nc in neighbors if nc not in visited]
        self._queue.extend(sorted(list(neighbors), key=lambda e: rng.random()))
        while self._queue:
            # dfs pops from the right
            nc = self._queue.pop()
            if nc in visited:
                continue
            # use dfs construal if it is below a size
            if len(nc) <= self.bound:
                return nc
            else:
                self._queue.append(nc)
            # otherwise use bfs
            nc = self._queue.popleft()
            if nc in visited:
                continue
            else:
                return nc