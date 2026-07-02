import random
from collections import deque

import matplotlib.pyplot as plt

from mdps import GridWorld


def generate_grid(width: int, height: int) -> GridWorld:
    goal = (width - 1, height - 1)

    # randomly generate a set of 1x1 obstacles
    num_obstacles = random.randint(5, 10)

    obstacles = []
    obstacle_names = []
    taken_coordinates = {(0, 0), goal}

    print(f"starting generation of {num_obstacles} obstacles")
    placed_obstacles = 0
    for i in range(num_obstacles):
        obstacle_name = str(i)
        obstacle = []

        # Choose obstacle size (number of blocks)
        num_blocks = random.randint(3, 6)  # e.g., 3 to 6 blocks per obstacle

        # Try to find a valid starting point
        start_coord = goal
        while start_coord in taken_coordinates:
            start_x = random.randint(0, width - 1)
            start_y = random.randint(0, height - 1)
            start_coord = (start_x, start_y)

        obstacle.append(start_coord)
        potential_growth_points = obstacle.copy()  # Points from which to grow

        # print(f"rooted obstacle at {start_coord}")

        while len(obstacle) < num_blocks and potential_growth_points:
            # Pick a random block from the current obstacle to grow from
            grow_from = random.choice(potential_growth_points)
            potential_growth_points.remove(
                grow_from
            )  # Only try growing once from here unless re-added

            neighbors = [
                (grow_from[0] + dx, grow_from[1] + dy)
                for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]
            ]
            neighbors = [
                n
                for n in neighbors
                if (n not in obstacle)
                and (n not in taken_coordinates)
                and (0 <= n[0] < width and 0 <= n[1] < height)
            ]
            # print("neighbors", neighbors)

            if neighbors:
                # Choose a random valid neighbor to add
                chosen_neighbor = random.choice(neighbors)
                obstacle.append(chosen_neighbor)
                potential_growth_points.append(
                    chosen_neighbor
                )  # The new block can also be grown from
                # print(f"growing from {obstacle[:-1]} -> {chosen_neighbor}")

        taken_coordinates |= set(obstacle)
        obstacles.append(obstacle)
        obstacle_names.append(obstacle_name)
        placed_obstacles += 1
        # print("\n\n")

    return GridWorld(width, height, goal, obstacles, obstacle_names=obstacle_names)


def check_valid(grid: GridWorld):
    node = (0, 0)
    queue = deque([node])
    visited = set()
    while len(queue) > 0:
        node = queue.popleft()
        visited.add(node)
        if node == grid.goal:
            return True
        for neighbor in grid.neighbors(node):
            if neighbor not in visited:
                queue.append(neighbor)

    return False

if __name__ == "__main__":
    import json

    grids = {}
    generated = 0
    while generated < 40:
        grid = generate_grid(10, 10)
        if check_valid(grid):
            generated += 1
            grids[f"procgen_grid_{generated}"] = grid.to_strings()

    with open("./data/procgen_grids.json", "w") as f:
        json.dump(grids, f)
