import numpy as np
import random
from typing import *


class GridWorld:
    def __init__(
        self,
        W,
        H,
        goal,
        obstacles,
        discount=0.99,
        obstacle_names=None,
        # transition=None,
        error_prob=1e-5,
        collision_cost=2
    ):
        # states = (x, y) coordinates, NOT indices of the grid, which would be (y, x).
        self.width = W
        self.height = H
        self.obstacles = obstacles
        self.obstacle_names = obstacle_names
        self.goal = goal
        self.error_prob = error_prob
        self.collision_cost = collision_cost

        self.discount = discount
        # self.discount = 1 - 1e-5

        self.states = [(i, j) for i in range(W) for j in range(H)]
        self.states = [s for s in self.states if not self.check_collision(s)]
        self.actions = [(0, 1), (1, 0), (0, -1), (-1, 0)]

    def transition(self, s, a):
        if s == self.goal:
            return [(self.goal, 0)]  # end episode

        i, j = s
        i += a[0]
        j += a[1]

        out = {}
        if self.check_collision((i, j)):
            # return [(s, 1)]
            out[s] = 1 - self.error_prob
        else:
            out[(i, j)] = 1 - self.error_prob

        if self.error_prob > 0:
            for a_error in self.actions:
                if a_error == a:
                    continue
                s_error = (s[0] + a_error[0], s[1] + a_error[1])
                if self.check_collision(s_error):
                    out.setdefault(s, 0)
                    out[s] += self.error_prob / (len(self.actions) - 1)
                else:
                    out.setdefault(s_error, 0)
                    out[s_error] += self.error_prob / (len(self.actions) - 1)

        return list(out.items())

    def reward(self, s, a, s_):
        if s == self.goal:
            return 0
        # if self.check_collision((s[0] + a[0], s[1] + a[1])):
        #     return self.collision_cost
        if s == s_: # a collision must have occurred
            return -self.collision_cost
        return -1

    def manhattan(self, s, goal=None):
        goal = goal if goal else self.goal
        m = abs(s[0] - goal[0]) + abs(s[1] - goal[1])
        return m

    def neighbors(self, s, construal=None):
        if construal is None:
            construal = list(range(len(self.obstacles)))
        _ns = set([
            (min(s[0] + 1, self.width - 1), s[1]),
            (s[0], min(s[1] + 1, self.height - 1)),
            (max(s[0] - 1, 0), s[1]),
            (s[0], max(s[1] - 1, 0)),
        ])

        return [n for n in _ns if not any(n in self.obstacles[i] for i in construal)]

    def check_collision_construal(self, s):
        # returns whether the state is consistent with the construal, and returns any intersections if not
        for i, o in enumerate(self.obstacles):
            if s in o:
                return False, {i}

        if s[0] < 0 or s[0] >= self.width or s[1] < 0 or s[1] >= self.height:
            return False, {}

        return True, None

    def check_collision(self, s):
        for o in self.obstacles:
            if s in o:
                return True

        if s[0] < 0 or s[0] >= self.width or s[1] < 0 or s[1] >= self.height:
            return True
        return False

    def viz(self, start=None, colors=None, labels=False, width=0, ax=None):
        import matplotlib.pyplot as plt
        if not ax:
            fig, ax = plt.subplots()

        for s in self.states:
            if width > 0 and self.check_collision(s):
                continue
            ax.add_patch(plt.Rectangle(s, 1, 1, ec="lightgray", fc="white", lw=1))

        if start:
            ax.add_patch(plt.Circle((start[0] + 0.5, start[1] + 0.5), 0.25, fc="none", ec="blue"))


        for i, o in enumerate(self.obstacles):
            c = "black" if not colors else colors[i]
            for s in o:
                # ax.add_patch(plt.Rectangle(s, 1, 1, ec="lightgray", fc=c, lw=0 if width > 0 else 1))
                ax.add_patch(plt.Rectangle(s, 1, 1, ec="lightgray", fc=c, lw=1))

            if width == 0:
                continue

            # any edges on the interior will be shared twice
            from collections import Counter
            edges = []
            for s in o:
                edges.append(((s[0], s[1]), (s[0] + 1, s[1])))
                edges.append(((s[0], s[1]), (s[0], s[1] + 1)))
                edges.append(((s[0] + 1, s[1]), (s[0] + 1, s[1] + 1)))
                edges.append(((s[0], s[1] + 1), (s[0] + 1, s[1] + 1)))

            edge_counts = Counter(edges)
            exterior_edges = []
            for e, count in edge_counts.items():
                if count == 1:
                    exterior_edges.append(e)

            for edge in exterior_edges:
                ax.plot([edge[0][0], edge[1][0]], [edge[0][1], edge[1][1]], c="black", lw=width)

        # ax.add_patch(plt.Rectangle(self.goal, 1, 1, ec="yellow", fc="green", lw=2, zorder=1))
        ax.add_patch(plt.Rectangle((self.goal[0] + 0.1, self.goal[1] + 0.1), 0.8, 0.8, ec="yellow", fc="green", lw=2, zorder=1))

        if labels:
            for i, o in zip(self.obstacle_names, self.obstacles):
                center = np.array(o).mean(axis=0)
                plt.text(center[0], center[1], f"{i}", c="red", fontsize=12, fontweight="bold")

        ax.autoscale_view()
        plt.axis("off")
        plt.axis("equal")


    @classmethod
    def from_string(cls, s):
        obstacles = {}
        g = (0, 0)
        start = (0, 0)
        for i, j in np.ndindex(len(s), len(s[0])):
            if s[i][j] == "G":
                g = (j, len(s) - 1 - i)
            elif s[i][j] == "S":
                start = (j, len(s) - 1 - i)
            elif s[i][j] != ".":
                obstacles.setdefault(s[i][j], []).append((j, len(s) - 1 - i))
        return cls(len(s[0]), len(s), g, list(obstacles.values()), obstacle_names=list(obstacles.keys()))

    def to_strings(self):
        strs = []
        for j in range(self.height):
            row = []
            for i in range(self.width):
                obj = next((on for o, on in zip(self.obstacles, self.obstacle_names) if (i, j) in o), None)
                if obj is not None:
                    row.append(obj)
                elif (i, j) == self.goal:
                    row.append("G")
                else:
                    row.append(".")
            strs.append(row)
        strs[0][0] = "S"
        return strs[::-1]

if __name__ == "__main__":
    import json
    import matplotlib.pyplot as plt
    with open("data/mazes_12-15.json") as f:
        memory_maze = json.load(f)

    maze = GridWorld.from_string(memory_maze["grid-12"])
    maze.viz(width=2, colors=[(0, 0, 0, 0.5) for _ in maze.obstacles])