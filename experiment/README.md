# Maze jsPsych Experiment

This folder contains a jsPsych-based route-planning experiment in which participants choose travel paths on a graph of cities and flights, inspect edge/node information, practice two familiar routes, complete timed test trials, and answer intermittent recall probes about the graph structure.

## Key Files

### `jspsych-itinerary-graph.js`

Custom jsPsych 7 plugin that powers the graph task itself. It:

- Renders the city network as an SVG graph with configurable ring-order or explicit node positions.
- Displays node and edge information labels, including city names, quarantine information, travel duration, and flight cost.
- Supports interaction logic such as left-click edge selection, right-click or hover label reveal, label dragging, edge highlighting, clearing selections, countdown timers, and submit/continue controls.
- Computes trial outcomes, including whether the submitted route is a valid simple path, the resulting loss under configurable time/money/virus weights, and timeout handling.
- Logs rich behavioral data such as event histories, time spent viewing information, time spent selecting edges, invalid submit attempts, and recall-probe responses.
- Exposes `renderItineraryGraphStatic(...)` so the same plugin can also be reused for non-trial displays such as instruction examples.

### `exp3_15_norule.html`

Standalone experiment entry page for one version of Experiment 3 with 15 test trials and the "no quarantine-cost rule" stimulus bundle. It:

- Loads jsPsych, the custom graph plugin, helper scripts, and the problem bundle/CSV for this experiment version.
- Defines the study configuration, including number of practice and test trials, timing, loss weights, subject-specific city-name remapping, and bonus computation.
- Samples two familiar cached routes and a balanced set of test problems for each participant.
- Builds the full timeline: browser check, consent, preload, fullscreen, instructions, familiar-route practice, comprehension checks, main test trials, recall probes, demographics, saving, and completion screen.
- Saves subject metadata and trial data, including MTurk identifiers and a local/server copy of the final dataset.

## `utils/` Folder

### `utils/exp3_helpers.js`

Shared helper library for Experiment 3. Its main responsibilities are:

- Loading the trial CSV and creating seeded randomization helpers.
- Sampling familiar cached routes and balanced test-trial sets from the stimulus table.
- Creating subject-specific city-name remappings and converting internal path strings into displayed names.
- Building practice-trial timelines, reminder/restart screens, and logic for repeated familiar-route training.
- Generating equation strings and path summaries used in instructions and feedback.
- Constructing and classifying recall probes, including cached-route, branch, and irrelevant-edge probe schedules.
- Computing bonus-related values and other bookkeeping summaries used after test trials.

Note: this file currently contains some repeated helper definitions from iterative development, but it functions as the central experiment-assembly utility file.

### `utils/itinerary_graph_renderer.js`

Small wrapper around the custom plugin for display-only or sandbox rendering outside a normal jsPsych trial. It:

- Defines safe default settings for static graph rendering.
- Builds a trial-like config object from user input.
- Instantiates the plugin with a minimal jsPsych stub.
- Exposes `window.ItineraryGraphRenderer.render(...)` and `window.renderItineraryGraphStatic(...)` so instruction pages can embed example graphs without running a full experiment trial.

### `utils/jspsych_conversion_txt_to_csv.ipynb`

Utility notebook for offline data cleaning. It defines a Python helper that reads a jsPsych `displayData()` text dump, parses the JSON trial list, optionally stringifies nested objects/lists, and saves the result as a CSV for later analysis.

### `utils/.ipynb_checkpoints/jspsych_conversion_txt_to_csv-checkpoint.ipynb`

Auto-generated Jupyter checkpoint for the notebook above. It is not part of the runtime experiment; it is a backup snapshot created by Jupyter.

## In Practice

For this experiment version, `exp3_15_norule.html` is the top-level page, `jspsych-itinerary-graph.js` provides the interactive graph trial type, and the `utils` scripts support sampling, practice/recall logic, static rendering, and data conversion.
