/**
 * jspsych-itinerary-graph.js
 *
 * jsPsych 7 plugin that renders a graph (nodes/edges) using an SVG shell layout.
 *
 * Supports:
 *  - Fixed ring order per subject (trial.ring_order)
 *  - Optional explicit node positions (trial.node_pos) that override ring layout
 *  - Optional displayed_city_names mapping for node text shown on graph
 *  - Labels (node + edge) as SVG <foreignObject> HTML boxes with wrapping
 *  - Right-click reveal labels
 *  - Optional hover reveal labels
 *  - Optional multiple persistent right-click-open labels
 *  - Event log records when labels actually appear/disappear
 *  - Left-click edge selection (green edges + endpoint nodes)
 *  - Optional right-click highlight (thicker) when reveal mode is off
 *  - Clear button + Continue button on the RIGHT of canvas
 *  - Labels are clamped to remain inside the SVG canvas by shifting minimally
 *
 * Expected problem format:
 * problem = {
 *   start: "StartTown",
 *   goal: "GoalCity",
 *   nodes: [{id, virus, q_cost_per_day, rule_text}, ...],
 *   edges: [{u, v, duration, cost}, ...],
 *   best_path: ["StartTown","HubCity","GoalCity"] // optional
 * }
 */

var jsPsychItineraryGraph = (function (jspsych) {
  "use strict";

  const info = {
    name: "itinerary-graph",
    parameters: {
      problem: { type: jspsych.ParameterType.OBJECT, default: null },

      // --- Layout ---
      ring_order: {
        type: jspsych.ParameterType.STRING,
        array: true,
        default: null,
        description: "Array of node ids defining order around the ring. If null, uses problem.nodes order.",
      },
      node_pos: {
        type: jspsych.ParameterType.OBJECT,
        default: null,
        description: "Optional explicit node positions {id:{x,y}} in SVG coords. If provided, overrides ring layout.",
      },
      displayed_city_names: {
        type: jspsych.ParameterType.OBJECT,
        default: null,
        description: "Mapping from raw city names to displayed city names in the graph.",
      },
      right_panel_hint_html:{
        type: jspsych.ParameterType.STRING,
        default: "",
        description: "Optimal black HTML hint to display during training. Below countdown, above other hints/buttons."
      },

      radius: { type: jspsych.ParameterType.INT, default: 220 },
      center_x: { type: jspsych.ParameterType.INT, default: 300 },
      center_y: { type: jspsych.ParameterType.INT, default: 300 },
      width: { type: jspsych.ParameterType.INT, default: 600 },
      height: { type: jspsych.ParameterType.INT, default: 600 },

      // --- Rendering toggles ---
      show_nodes: { type: jspsych.ParameterType.BOOL, default: true },
      show_edges: { type: jspsych.ParameterType.BOOL, default: true },
      show_start_goal_badges: { type: jspsych.ParameterType.BOOL, default: true },
      highlight_best_path: { type: jspsych.ParameterType.BOOL, default: false },
      include_cityname: { type: jspsych.ParameterType.BOOL, default: true },
      include_virus: { type: jspsych.ParameterType.BOOL, default: true },
      include_q_cost: { type: jspsych.ParameterType.BOOL, default: true },

      // --- Labels ---
      bold_path_string: {
        type: jspsych.ParameterType.STRING,
        default: null,
        description: "Optional path string in original node names whose edges should be shown as bold by default, e.g. 'StartTown→A→E→GoalCity'."
      },
      bold_path_string_color: {
        type: jspsych.ParameterType.STRING,
        default: "#1DE312",
        description: "Optional path string color."
      },
      bold_path_string_edgewidth: {
        type: jspsych.ParameterType.INT,
        default: 6,
        description: "Optional path string edgewidth, before being revealed."
      },
      reveal_bold_path_labels_by_default: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true and bold_path_string is provided, reveal all node and edge labels along that path on initialization."
      },
      allow_allinteractions: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "Instruction-widget override. Allows graph interactions and right-panel exploration without countdown or active submit."
      },
      labels_visible_by_default: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true, labels are all visible from start (no reveal needed).",
      },
      render_hidden_labels: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, creates labels and toggles visibility via reveal/hide.",
      },

      enable_reveal_labels: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "Right-click node/edge to reveal information.",
      },
      allow_multiple_right_click_labels: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true, multiple right-click-open labels may remain visible at once. Only affects enable_reveal_labels=true.",
      },
      enable_hover_reveal: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, hovering over a node/edge reveals its label; leaving hides it.",
      },
      hover_reveal_delay_ms: { type: jspsych.ParameterType.INT, default: 300 },
      hover_hide_delay_ms: { type: jspsych.ParameterType.INT, default: 0 },
      hover_edge_hit_width: {
        type: jspsych.ParameterType.INT,
        default: 20,
        description: "Invisible hover hit width for edges (px).",
      },

      // three-state left-click mode
      enable_three_state_left_click: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true, left-click uses a three-state cycle. For edges: hidden -> inspected -> selected -> hidden. For nodes: hidden -> inspected -> hidden."
      },
      record_state_transition_log: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, save object state transitions and interval summaries for nodes/edges."
      },
      keep_right_click_reveal_when_three_state: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true, right-click reveal remains available even when three-state left-click is enabled. Usually leave false."
      },
      record_route_snapshots: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, save selected-edge snapshots after edge state changes."
      },

      // label box sizing
      label_max_width_px: { type: jspsych.ParameterType.INT, default: 300 }, // 200
      label_max_height_px: { type: jspsych.ParameterType.INT, default: 260 },
      label_font_px: { type: jspsych.ParameterType.INT, default: 12 },
      label_line_height_px: { type: jspsych.ParameterType.INT, default: 16 },
      label_padding_px: { type: jspsych.ParameterType.INT, default: 8 },

      // --- Interactions ---
      enable_select_edges: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "Left-click an edge to toggle selection (green).",
      },
      enable_highlight: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "Right-click edge toggles highlight (thicker). Only active if reveal mode is off.",
      },
      enable_drag_labels: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, visible labels can be left-click dragged and keep their moved positions when hidden/re-shown.",
      },
      label_drag_threshold_px: {
        type: jspsych.ParameterType.INT,
        default: 4,
        description: "Minimum mouse movement before a label drag counts as a drag rather than a click.",
      },
      constrain_labels_to_canvas: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true, visible labels are kept within the SVG canvas, which may override left-click dragging; if false, they may be dragged outside.",
      },
      label_drag_grip_size_px: {
        type: jspsych.ParameterType.INT,
        default: 12,
        description: "Diameter of the draggable grip circle inside the label's top-left corner.",
      },
      drag_whole_label: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true and enable_drag_labels=true, drag by left-clicking anywhere on the label body instead of only the top-left grip.",
      },

      // --- Trial flow ---
      prompt: { type: jspsych.ParameterType.HTML_STRING, default: "" },
      button_label: { type: jspsych.ParameterType.STRING, default: "Submit" },
      require_continue_button: { type: jspsych.ParameterType.BOOL, default: true },

      // clear
      show_clear_button: { type: jspsych.ParameterType.BOOL, default: true },
      clear_button_label: { type: jspsych.ParameterType.STRING, default: "Clear everything" },
      clear_also_hides_label: { type: jspsych.ParameterType.BOOL, default: true },

      // Trialwise time limits
      time_limit_sec: {
        type: jspsych.ParameterType.INT,
        default: null,
        description: "Optional time limit per trial in seconds."
      },
      force_end_on_timeout: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, force-end the trial when the countdown reaches 0."
      },
      show_countdown: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, show a countdown timer when time_limit_sec is provided."
      },

      // Optional, used for training: block submission & pop-up warning if submitted path is not a cached solution.
      acceptable_paths: {
        type: jspsych.ParameterType.STRING,
        array: true,
        default: null,
        description: "Optional list of acceptable path strings, e.g. ['StartTown→A→GoalCity','StartTown→A→B→GoalCity']. If null or empty, no acceptable-path restriction is enforced."
      },
      show_right_panel: {
        type: jspsych.ParameterType.BOOL,
        default: true
      },
      interactive_graph: {
        type: jspsych.ParameterType.BOOL,
        default: true
      },

      // --- Data logging ---
      record_event_log: { type: jspsych.ParameterType.BOOL, default: true },
      // --- Evaluation ---
      require_simple_path: {
        type: jspsych.ParameterType.BOOL,
        default: true,
        description: "If true, submission must be a single simple path from start to goal."
      },

      loss_weights: {
        type: jspsych.ParameterType.OBJECT,
        default: { time: 100, money: 1, virus: 0 },
        description: "Weights for computing total loss."
      },

      invalid_submission_cost: {
        type: jspsych.ParameterType.FLOAT,
        default: Infinity,
        description: "Loss assigned if submission is invalid and allowed."
      },


      // For recall probes between test trials
      trial_mode: {
        type: jspsych.ParameterType.STRING,
        default: "task", // "task" | "recall_probe"
        description: "If 'recall_probe', show graph-only memory probe with Yes/No response."
      },

      recall_probe_nodes: {
        type: jspsych.ParameterType.STRING,
        array: true,
        default: null,
        description: "Exactly two node ids being queried in recall probe mode."
      },

      recall_probe_question_html: {
        type: jspsych.ParameterType.HTML_STRING,
        default: "Was there a direct flight between these two cities?",
        description: "Question shown in the right panel in recall probe mode."
      },

      recall_probe_show_candidate_edge: {
        type: jspsych.ParameterType.BOOL,
        default: false,
        description: "If true, draw a black candidate edge between the two queried nodes in recall probe mode."
      },

      recall_probe_yes_label: {
        type: jspsych.ParameterType.STRING,
        default: "Yes"
      },

      recall_probe_no_label: {
        type: jspsych.ParameterType.STRING,
        default: "No"
      },

      recall_probe_correct_answer: {
        type: jspsych.ParameterType.BOOL,
        default: null,
        description: "Optional ground-truth answer for scoring/logging."
      },

      recall_probe_gray_hex: {
        type: jspsych.ParameterType.STRING,
        default: "#dcdedc",
        description: "Gray used for non-queried nodes in recall probe mode."
      },

      // For widget in instructions: left-click and reveal node/edge labels at least once before allowing user to proceed.
      instruction_progress_callback: {
        type: jspsych.ParameterType.FUNCTION,
        default: null,
        description: "Optional callback receiving sandbox/instruction interaction progress."
      },
    },
  };

  function canonicalEdgeId(u, v) {
    return (u < v) ? `${u}--${v}` : `${v}--${u}`;
  }

  function domSafeId(s) {
    return String(s).replace(/[^a-zA-Z0-9\-_:.]/g, "_");
  }

  function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
      return Math.hypot(px - x1, py - y1);
    }
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  function edgeMidpointDistance(px, py, x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return Math.hypot(px - mx, py - my);
  }

  class ItineraryGraphPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      if (!trial.problem) {
        throw new Error("itinerary-graph plugin: trial.problem is required.");
      }

      const instructionProgress = {
        has_selected_edge: false,
        has_hovered_node: false,
        has_hovered_edge: false,
        has_revealed_node: false,
        has_revealed_edge: false,
        has_dragged_label: false
      };

      function emitInstructionProgress() {
        if (typeof trial.instruction_progress_callback === "function") {
          trial.instruction_progress_callback({
            has_selected_edge: instructionProgress.has_selected_edge,
            has_hovered_node: instructionProgress.has_hovered_node,
            has_hovered_edge: instructionProgress.has_hovered_edge,
            has_revealed_node: instructionProgress.has_revealed_node,
            has_revealed_edge: instructionProgress.has_revealed_edge,
            has_dragged_label: instructionProgress.has_dragged_label,
            ready:
              instructionProgress.has_selected_edge &&
              instructionProgress.has_revealed_node &&
              instructionProgress.has_revealed_edge &&
              instructionProgress.has_dragged_label
          });
        }
      }

      const problem = trial.problem;
      const nodes = Array.isArray(problem.nodes) ? problem.nodes.slice() : [];
      const edges = Array.isArray(problem.edges) ? problem.edges.slice() : [];
      const displayedCityNames = trial.displayed_city_names || null;

      const isRecallProbe = trial.trial_mode === "recall_probe";
      const recallProbeNodes = Array.isArray(trial.recall_probe_nodes)
        ? trial.recall_probe_nodes.slice(0, 2)
        : [];
      const recallProbeNodeSet = new Set(recallProbeNodes);
      if (isRecallProbe && recallProbeNodes.length !== 2) {
        throw new Error("itinerary-graph plugin: recall_probe mode requires exactly two recall_probe_nodes.");
      }

      const sandboxMode = !!trial.allow_allinteractions && !isRecallProbe;
      const showRightPanel = isRecallProbe ? true : (!!trial.show_right_panel || sandboxMode);
      const graphInteractive = isRecallProbe ? false : (!!trial.interactive_graph || sandboxMode);
      const effectiveEnableSelectEdges =
        isRecallProbe ? false : (!!trial.enable_select_edges && graphInteractive);
      const effectiveEnableRevealLabels =
        isRecallProbe ? false : (!!trial.enable_reveal_labels && graphInteractive);
      const effectiveEnableHoverReveal =
        isRecallProbe ? false : (!!trial.enable_hover_reveal && graphInteractive);
      const effectiveEnableHighlight =
        isRecallProbe ? false : (!!trial.enable_highlight && graphInteractive && !effectiveEnableRevealLabels);
      const effectiveEnableDragLabels =
        isRecallProbe ? false : !!trial.enable_drag_labels;
      const enableSubmit = isRecallProbe ? false : (!!trial.interactive_graph && !sandboxMode);
      const effectiveShowEdges = isRecallProbe ? false : !!trial.show_edges;
      const effectiveShowStartGoalBadges = isRecallProbe ? false : !!trial.show_start_goal_badges;
      const effectiveRenderHiddenLabels = isRecallProbe ? false : !!trial.render_hidden_labels;
      const effectiveShowClearButton = isRecallProbe ? false : !!trial.show_clear_button;

      // Three-state left-click mode
      const effectiveEnableThreeStateLeftClick =
        !isRecallProbe &&
        graphInteractive &&
        !!trial.enable_three_state_left_click;
      // In three-state mode, left-click handles inspection+selection.
      // Keep hover-reveal optional, but turn off normal right-click reveal/highlight unless explicitly requested.
      const effectiveEnableRevealLabelsFinal =
        effectiveEnableThreeStateLeftClick
          ? !!trial.keep_right_click_reveal_when_three_state && effectiveEnableRevealLabels
          : effectiveEnableRevealLabels;
      const effectiveEnableHighlightFinal =
        effectiveEnableThreeStateLeftClick
          ? false
          : effectiveEnableHighlight;


      const boldPathStringColor = trial.bold_path_string_color || "#1DE312";
      const boldPathStringEdgeWidth = trial.bold_path_string_edgewidth || 6;

      // Countdown/timer only runs in normal interactive trials, never in sandbox mode.
      const enableCountdown =
        !sandboxMode &&
        trial.time_limit_sec != null &&
        trial.show_countdown;

      // Count invalid submissions that triggered the pop-up window
      let invalidSubmitCountBeforeSuccess = 0;
      let invalidSubmitAttempts = [];
      function recordInvalidSubmitAttempt(reason, result, acceptableInfo = null) {
        const submittedPath = result && result.components ? result.components.path : null;
        const submittedPathString = submittedPath ? pathArrayToArrowString(submittedPath) : null;

        invalidSubmitCountBeforeSuccess += 1;

        invalidSubmitAttempts.push({
          attempt_index: invalidSubmitCountBeforeSuccess,
          reason: reason,  // e.g. "invalid_structure", "not_acceptable_path"
          submitted_path: submittedPath,
          submitted_path_string: submittedPathString,
          submitted_path_displayed: submittedPathString
            ? convertPathToDisplayedCityNames(submittedPathString, trial.displayed_city_names)
            : null,
          loss_if_computed: result ? result.loss : null,
          valid_structure: result ? !!result.valid : null,
          acceptable_paths_restriction_active: acceptableInfo ? !!acceptableInfo.restriction_active : null,
          matched_acceptable_index: acceptableInfo ? acceptableInfo.matched_index : null,
          elapsed_time_sec: getElapsedSec()
        });
      }



      function getDisplayedCityName(originalName) {
        if (
          displayedCityNames &&
          Object.prototype.hasOwnProperty.call(displayedCityNames, originalName)
        ) {
          return String(displayedCityNames[originalName]);
        }
        return String(originalName);
      }
      function normalizePathString(pathStr) {
        if (pathStr == null) return null;
        return String(pathStr).trim();
      }

      function parsePathStringToNodeList(pathStr) {
        const s = normalizePathString(pathStr);
        if (!s) return null;
        return s.split("→").map(x => x.trim()).filter(x => x.length > 0);
      }

      function edgeKey(u, v) {
        return [u, v].sort().join("||");
      }


      function pathStringToNodeList(pathStr) {
        const s = normalizePathString(pathStr);
        if (!s) return [];
        return s.split("→").map(x => x.trim()).filter(x => x.length > 0);
      }

      function pathStringToNodeSet(pathStr) {
        return new Set(pathStringToNodeList(pathStr));
      }
      function pathStringToEdgeKeySet(pathStr) {
        const nodes = parsePathStringToNodeList(pathStr);
        if (!nodes || nodes.length < 2) return new Set();

        const out = new Set();
        for (let i = 0; i < nodes.length - 1; i++) {
          out.add(edgeKey(nodes[i], nodes[i + 1]));
        }
        return out;
      }
      const boldPathNodeSet = pathStringToNodeSet(trial.bold_path_string);
      const alwaysBoldEdgeKeys = pathStringToEdgeKeySet(trial.bold_path_string); // If bold certain paths by default
      const boldPathEdgeKeySet = alwaysBoldEdgeKeys;

      function pathArrayToArrowString(pathArr) {
        if (!Array.isArray(pathArr)) return null;
        return pathArr.join("→");
      }

      function convertPathToDisplayedCityNames(pathStr, displayed_city_names) {
        if (pathStr == null) return null;

        const parts = String(pathStr).split("→").map(s => s.trim());
        const converted = parts.map(city => {
          if (
            displayed_city_names &&
            typeof displayed_city_names === "object" &&
            displayed_city_names[city] !== undefined
          ) {
            return displayed_city_names[city];
          }
          return city;
        });

        return converted.join("→");
      }

      function getAcceptablePathMatchInfo(submittedPathString, acceptablePaths) {
        const submitted = normalizePathString(submittedPathString);

        if (!Array.isArray(acceptablePaths) || acceptablePaths.length === 0) {
          return {
            restriction_active: false,
            is_acceptable: true,
            matched_index: null
          };
        }

        for (let i = 0; i < acceptablePaths.length; i++) {
          const candidate = normalizePathString(acceptablePaths[i]);
          if (submitted === candidate) {
            return {
              restriction_active: true,
              is_acceptable: true,
              matched_index: i + 1   // 1-based label
            };
          }
        }

        return {
          restriction_active: true,
          is_acceptable: false,
          matched_index: 0
        };
      }

      function buildAcceptablePathsWarningMessage(result) {
        const submittedRaw = result && result.components ? pathArrayToArrowString(result.components.path) : null;
        const submittedDisplayed = submittedRaw
          ? convertPathToDisplayedCityNames(submittedRaw, trial.displayed_city_names)
          : "(none)";

        const acceptableDisplayed = Array.isArray(trial.acceptable_paths)
          ? trial.acceptable_paths.map(p => convertPathToDisplayedCityNames(p, trial.displayed_city_names))
          : [];

        let msg = "";

        // if (result && !result.valid) {
        //   msg += "Your route is invalid: " + (result.reason || "invalid path") + "\n\n";
        // }

        msg += "Your submitted route is not one of the acceptable paths.\n\n";
        // msg += "Submitted route:\n" + submittedDisplayed + "\n\n";

        if (acceptableDisplayed.length > 0) {
          msg += "<b>Acceptable path(s):</b>\n";
          for (let i = 0; i < acceptableDisplayed.length; i++) {
            msg += `${i + 1}. ${acceptableDisplayed[i]}\n`;
          }
        }

        return msg;
      }

      function formatRuleText(rule_text) {
        let displayed_label_text = String(rule_text)
          .replaceAll("Base:", "")
          .replaceAll("Modifying rules:", "<b>Exceptions (max applied):</b>")
          .replaceAll("(max days applied if multiple rules match)", "")
          .replaceAll("1 days", "1 day");

        if (trial.displayed_city_names !== null && trial.displayed_city_names !== undefined) {
          for (const [oldCityName, newCityName] of Object.entries(trial.displayed_city_names)) {
            displayed_label_text = displayed_label_text.replaceAll(
              " " + oldCityName + ":",
              " " + newCityName + ":"
            );
          }
        }
        return displayed_label_text;
      }

      function buildNodeLabel(node, startId, goalId) {
        const lines = [];

        if (trial.include_cityname) {
          if (node.id !== undefined) {
            lines.push(`<b><u>${getDisplayedCityName(node.id)}</u></b>\n`);
          }
        }

        if (trial.include_virus) {
          if (node.virus !== undefined) lines.push(`virus=${node.virus}% |`);
        }

        if (trial.include_q_cost) {
          if (node.q_cost_per_day !== undefined) lines.push(`$${node.q_cost_per_day} per day\n`);
        }

        if (node.rule_text !== undefined) {
          lines.push(`${formatRuleText(node.rule_text)}`);
        }

        return lines.join(" ");
      }

      function buildEdgeLabel(edge) {
        const lines = [];

        if (trial.include_cityname) {
          lines.push(
            `<b><u>${getDisplayedCityName(edge.u)} ⟷ ${getDisplayedCityName(edge.v)}</u></b>\n`
          );
        }

        if (edge.cost !== undefined) lines.push(`$${edge.cost} | `);
        if (edge.duration !== undefined) lines.push(formatRuleText(`${edge.duration} days`));

        return lines.join("");
      }

      // Time limit countdown
      let timerInterval = null;
      let trialStartTime = performance.now();
      let timedOut = false;
      let countdownEl = null;

      function formatTimerDisplay(totalSec) {
        // const sign = totalSec < 0 ? "-" : "";
        // const absSec = Math.abs(totalSec);
        // const mins = Math.floor(absSec / 60);
        // const secs = absSec % 60;
        // return `${sign}${mins}:${String(secs).padStart(2, "0")}`;
        return totalSec
      }

      function clearTimerIfNeeded() {
        if (timerInterval !== null) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
      }

      function getElapsedSec() {
        return Math.floor((performance.now() - trialStartTime) / 1000);
      }

      function getRemainingSec() {
        if (trial.time_limit_sec == null) return null;
        return trial.time_limit_sec - getElapsedSec();
      }
      

      function updateCountdownDisplay() {
        if (!countdownEl || trial.time_limit_sec == null) return;

        const remaining = getRemainingSec();
        countdownEl.textContent = formatTimerDisplay(remaining);

        if (remaining < 0) {
          // --- overtime: dark red ---
          countdownEl.style.color = "#8b0000";
        } else if (remaining < 30) {
          // --- warning: yellow-orange ---
          countdownEl.style.color = "#ff8c00"; // dark orange (readable)
        } else {
          // --- normal ---
          countdownEl.style.color = "#498505";
        }
      }

      function finishRecallProbe(response) {
        clearTimerIfNeeded();

        const data = {
          trial_mode: "recall_probe",
          recall_probe_nodes: recallProbeNodes.slice(),
          recall_probe_response: response, // "yes" | "no" | null
          recall_probe_correct_answer: trial.recall_probe_correct_answer,
          recall_probe_accuracy:
            (trial.recall_probe_correct_answer === null || trial.recall_probe_correct_answer === undefined || response == null)
              ? null
              : ((response === "yes") === !!trial.recall_probe_correct_answer),
          timed_out: !!timedOut,
          rt: performance.now() - trialStartTime
        };

        display_element.innerHTML = "";
        this.jsPsych.finishTrial(data);
      }
      const finishRecallProbeBound = finishRecallProbe.bind(this);


      // Build node map
      const nodeById = new Map();
      for (const n of nodes) nodeById.set(n.id, n);

      // Determine ring order
      let ringOrder = Array.isArray(trial.ring_order)
        ? trial.ring_order.slice()
        : nodes.map(n => n.id);

      ringOrder = ringOrder.filter(id => nodeById.has(id));
      for (const n of nodes) {
        if (!ringOrder.includes(n.id)) ringOrder.push(n.id);
      }

      // Parse city-specific quarantine rules (shared across trials)
      const quarantineRuleCache = new Map();
      for (const n of nodes) {
        quarantineRuleCache.set(n.id, parseQuarantineRuleText(n.rule_text));
      }

      // Compute positions
      const pos = {};
      const useExplicitPos = (trial.node_pos && typeof trial.node_pos === "object");

      if (useExplicitPos) {
        for (const id of ringOrder) {
          const p = trial.node_pos[id];
          if (!p || typeof p.x !== "number" || typeof p.y !== "number") {
            throw new Error(`itinerary-graph: node_pos missing/invalid for node "${id}"`);
          }
          pos[id] = { x: p.x, y: p.y };
        }
      } else {
        const cx = trial.center_x;
        const cy = trial.center_y;
        const R = trial.radius;
        const N = ringOrder.length;
        for (let i = 0; i < N; i++) {
          const theta = (2 * Math.PI * i) / N - Math.PI / 2;
          pos[ringOrder[i]] = {
            x: cx + R * Math.cos(theta),
            y: cy + R * Math.sin(theta),
          };
        }
      }

      // Best path edges
      const bestPath = Array.isArray(problem.best_path) ? problem.best_path : null;
      const bestEdgeSet = new Set();
      if (trial.highlight_best_path && bestPath && bestPath.length >= 2) {
        for (let i = 0; i < bestPath.length - 1; i++) {
          bestEdgeSet.add(canonicalEdgeId(bestPath[i], bestPath[i + 1]));
        }
      }

      // --- DOM / CSS ---
      display_element.innerHTML = "";

      const style = document.createElement("style");
      style.textContent = `
        #jspsych-target, #jspsych-content, .jspsych-content { overflow: visible !important; }

        .itg-wrap {
          display:flex;
          flex-direction:column;
          align-items:center;
          gap:10px;
          overflow:visible;
          position: relative;
        }
        .itg-prompt { max-width: 1000px; }

        .itg-main { display:flex; flex-direction:row; align-items:center; gap:36px; overflow:visible; }
        .itg-left { overflow:visible; }
        .itg-right {
          display:flex; flex-direction:column;
          justify-content:center; align-items:center;
          gap:12px;
          min-width: 220px;
          overflow:visible;
        }

        .itg-hint { font-size:12px; color:#444; max-width:300px; text-align:center; }
        .itg-custom-hint{
          font-size:14px;
          color:#000;
          max-width:300px;
          text-align:center;
        }

        .itg-svg {
          border:1px solid #ddd;
          background:#fff;
          user-select:none;
          overflow: visible;
        }

        .itg-node { cursor:pointer; }
        .itg-edge { cursor:pointer; }

        .itg-edge.best   { stroke-width: 5; opacity: 0.9; }
        .itg-edge.normal { stroke-width: 2; opacity: 0.65; }

        .itg-edge.selected { stroke: #1DE312 !important; stroke-width: 4; opacity: 0.95 !important; }
        .itg-node.selected { stroke: #1DE312 !important; stroke-width: 4 !important; }

        /* If the node is already reveal-bolded to 6px via inline style, keep 6px
          when it also becomes selected/green. */
        .itg-node.selected[style*="stroke-width: 6"] { stroke-width: 6px !important; }

        .itg-edge.highlighted { stroke-width: 6 !important; opacity: 0.95 !important; }
        .itg-edge.always-bold:not(.selected) {stroke: ${boldPathStringColor} !important; stroke-width: ${boldPathStringEdgeWidth}; opacity: 0.9; }
        .itg-edge.gray {
          stroke: #dcdedc;
          opacity: 0.6;
        }
        /* Cursor-target glow: shows exactly what would be interacted with now */
        .itg-edge.hover-target {
          filter: drop-shadow(0 0 1.5px rgba(255, 230, 0, 0.95))
                  drop-shadow(0 0 3px rgba(255, 230, 0, 0.75));
        }
        .itg-node.hover-target {
          filter: drop-shadow(0 0 1.5px rgba(255, 230, 0, 0.95))
                  drop-shadow(0 0 3px rgba(255, 230, 0, 0.75));
        }

        .itg-label-box.hover-target .itg-label-html {
          box-shadow:
            0 0 0 2px rgba(255, 230, 0, 0.95),
            0 0 8px rgba(255, 230, 0, 0.75);
        }

        .itg-label-box.hover-target .itg-label-grip {
          box-shadow:
            0 0 0 2px rgba(255, 230, 0, 0.95),
            0 0 8px rgba(255, 230, 0, 0.75);
        }


        .itg-label-hidden { display:none; }

        .itg-btn { padding: 8px 14px; }
        .itg-label-fo {
          overflow: visible;
          pointer-events: none;
        }

        .itg-label-shell {
          position: relative;
          display: inline-block;
          width: fit-content;
          max-width: var(--itg-maxw);
          max-height: var(--itg-maxh);
          pointer-events: none;
        }

        .itg-label-html {
          display: inline-block;
          width: auto;
          max-width: var(--itg-maxw);
          max-height: var(--itg-maxh);
          overflow: auto;
          font-size: var(--itg-font);
          line-height: var(--itg-lineh);
          padding: var(--itg-pad);
          background: rgba(255,255,255,0.92);
          border: 1px solid #000;
          border-radius: 7px;
          box-sizing: border-box;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
          pointer-events: auto;
          cursor: default;
        }

        .itg-label-grip {
          position: absolute;
          left: 1px;
          top: 1px;
          width: var(--itg-gripsz);
          height: var(--itg-gripsz);
          border-radius: 999px;
          background: rgba(100,100,100,0.80);
          border: 1.5px solid #fff;
          box-sizing: border-box;
          pointer-events: auto;
          cursor: grab;
        }

        .itg-label-box.dragging .itg-label-grip {
          cursor: grabbing;
        }
        .itg-label-box.dragging .itg-label-html {
          cursor: grabbing !important;
        }

        .itg-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.18);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 30;
          pointer-events: auto;
        }

        .itg-modal-overlay.show {
          display: flex;
        }

        .itg-modal {
          width: min(420px, 88%);
          background: #fff;
          border: 1px solid #333;
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.22);
          padding: 18px 18px 14px 18px;
          text-align: center;
        }

        .itg-modal-title {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 10px;
        }

        .itg-modal-body {
          font-size: 14px;
          line-height: 1.4;
          color: #222;
          margin-bottom: 14px;
          white-space: pre-wrap;
        }

        .itg-modal-actions {
          display: flex;
          justify-content: center;
        }

        .itg-modal-btn {
          padding: 8px 16px;
          border: 1px solid #444;
          border-radius: 8px;
          background: #f7f7f7;
          cursor: pointer;
          font-size: 14px;
        }
      `;
      display_element.appendChild(style);

      const wrap = document.createElement("div");
      wrap.className = "itg-wrap";
      display_element.appendChild(wrap);

      if (trial.prompt && trial.prompt.length > 0) {
        const promptDiv = document.createElement("div");
        promptDiv.className = "itg-prompt";
        promptDiv.innerHTML = trial.prompt;
        wrap.appendChild(promptDiv);
      }

      const main = document.createElement("div");
      main.className = "itg-main";
      wrap.appendChild(main);

      const leftCol = document.createElement("div");
      leftCol.className = "itg-left";
      main.appendChild(leftCol);

      const rightCol = document.createElement("div");
      rightCol.className = "itg-right";
      if (showRightPanel) {
        main.appendChild(rightCol);
      }

      // Warning pop-up
      const modalOverlay = document.createElement("div");
      modalOverlay.className = "itg-modal-overlay";
      modalOverlay.innerHTML = `
        <div class="itg-modal" role="dialog" aria-modal="true" aria-live="assertive">
          <div class="itg-modal-title">Invalid route!</div>
          <div class="itg-modal-body"></div>
          <div class="itg-modal-actions">
            <button type="button" class="itg-modal-btn">OK</button>
          </div>
        </div>
      `;

      const modalBody = modalOverlay.querySelector(".itg-modal-body");
      const modalOkBtn = modalOverlay.querySelector(".itg-modal-btn");

      function showWarningModal(message) {
        modalBody.innerHTML = message;
        modalOverlay.classList.add("show");
        modalOkBtn.focus();
      }

      function hideWarningModal() {
        modalOverlay.classList.remove("show");
      }

      if (graphInteractive) {
        modalOkBtn.addEventListener("click", () => {
          hideWarningModal();
        });

        modalOverlay.addEventListener("click", (e) => {
          if (e.target === modalOverlay) {
            hideWarningModal();
          }
        });

        document.addEventListener("keydown", function onModalEsc(e) {
          if (e.key === "Escape" && modalOverlay.classList.contains("show")) {
            hideWarningModal();
          }
        });
      }

      wrap.appendChild(modalOverlay);



      // Display time limit countdown

      if (showRightPanel) {
        if (enableCountdown) {
          countdownEl = document.createElement("div");

          // --- Position inside right panel ---
          rightCol.style.position = "relative";

          countdownEl.style.position = "absolute";
          countdownEl.style.top = "-80%";
          countdownEl.style.left = "50%";
          countdownEl.style.transform = "translateX(-50%)";

          // --- Style ---
          countdownEl.style.fontSize = "36px";
          countdownEl.style.fontWeight = "700";
          countdownEl.style.fontFamily = "monospace";
          countdownEl.style.lineHeight = "1";

          countdownEl.style.background = "rgba(255,255,255,0.95)";
          countdownEl.style.padding = "6px 12px";
          countdownEl.style.borderRadius = "8px";

          countdownEl.style.color = "#498505";
          countdownEl.style.zIndex = "9999";
          countdownEl.style.pointerEvents = "none"; // 🔥 important: doesn't block UI

          // --- Insert as first element in right panel ---
          rightCol.prepend(countdownEl);

          updateCountdownDisplay();
        }
        if (enableCountdown) {
          timerInterval = setInterval(() => {
            updateCountdownDisplay();

            const remaining = getRemainingSec();

            if (remaining <= 0 && trial.force_end_on_timeout && !timedOut) {
              timedOut = true;
              if (isRecallProbe) {
                finishRecallProbeBound(null);
              } else {
                finish(true);
              }
            }
          }, 250);
        }
      }

      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("class", "itg-svg");
      svg.setAttribute("width", String(trial.width));
      svg.setAttribute("height", String(trial.height));
      svg.setAttribute("viewBox", `0 0 ${trial.width} ${trial.height}`);
      svg.setAttribute("overflow", "visible");
      svg.style.overflow = "visible";

      svg.style.setProperty("--itg-maxw", `${trial.label_max_width_px}px`);
      svg.style.setProperty("--itg-maxh", `${trial.label_max_height_px}px`);
      svg.style.setProperty("--itg-font", `${trial.label_font_px}px`);
      svg.style.setProperty("--itg-lineh", `${trial.label_line_height_px}px`);
      svg.style.setProperty("--itg-pad", `${trial.label_padding_px}px`);
      svg.style.setProperty("--itg-gripsz", `${trial.label_drag_grip_size_px}px`);

      leftCol.appendChild(svg);

      const gEdges = document.createElementNS(svgNS, "g");
      const gNodes = document.createElementNS(svgNS, "g");
      const gLabels = document.createElementNS(svgNS, "g");
      svg.appendChild(gEdges);
      svg.appendChild(gNodes);
      svg.appendChild(gLabels);

      const CANVAS_PAD_PX = 6;

      function measureLabelBox(html, maxW, maxH, isHTML = true) {
        const probe = document.createElement("div");
        probe.className = "itg-label-html";
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.left = "-10000px";
        probe.style.top = "-10000px";
        probe.style.display = "inline-block";
        probe.style.width = "auto";
        probe.style.maxWidth = `${maxW}px`;
        probe.style.maxHeight = `${maxH}px`;
        probe.style.overflow = "visible";

        if (isHTML) {
          probe.innerHTML = html;
        } else {
          probe.textContent = html;
        }

        display_element.appendChild(probe);

        const rect = probe.getBoundingClientRect();
        const measuredW = Math.min(maxW, Math.ceil(rect.width));
        const measuredH = Math.min(maxH, Math.ceil(rect.height));

        display_element.removeChild(probe);

        return {
          width: Math.max(1, measuredW),
          height: Math.max(1, measuredH),
        };
      }

      function clampLabelGroupToSvgCanvas(groupEl) {
        if (!groupEl) return;
        if (groupEl.classList.contains("itg-label-hidden")) return;

        applyLabelTransform(groupEl);

        if (!trial.constrain_labels_to_canvas) return;

        const div = groupEl.querySelector(".itg-label-html");
        if (!div) return;

        const ax = parseFloat(groupEl.dataset.anchorX || "0");
        const ay = parseFloat(groupEl.dataset.anchorY || "0");
        const ox = parseFloat(groupEl.dataset.offsetX || "0");
        const oy = parseFloat(groupEl.dataset.offsetY || "0");

        const svgRect = svg.getBoundingClientRect();
        const labRect = div.getBoundingClientRect();

        let dxPx = 0;
        let dyPx = 0;

        const leftBound = svgRect.left + CANVAS_PAD_PX;
        const rightBound = svgRect.right - CANVAS_PAD_PX;
        const topBound = svgRect.top + CANVAS_PAD_PX;
        const bottomBound = svgRect.bottom - CANVAS_PAD_PX;

        if (labRect.left < leftBound) dxPx += (leftBound - labRect.left);
        if (labRect.right > rightBound) dxPx -= (labRect.right - rightBound);
        if (labRect.top < topBound) dyPx += (topBound - labRect.top);
        if (labRect.bottom > bottomBound) dyPx -= (labRect.bottom - bottomBound);

        const sx = trial.width / svgRect.width;
        const sy = trial.height / svgRect.height;

        const dxSvg = dxPx * sx;
        const dySvg = dyPx * sy;

        const newOx = ox + dxSvg;
        const newOy = oy + dySvg;

        groupEl.dataset.offsetX = String(newOx);
        groupEl.dataset.offsetY = String(newOy);
        groupEl.setAttribute("transform", `translate(${ax + newOx}, ${ay + newOy})`);
      }

      // --- State ---
      const edgeDom = new Map();
      const nodeDom = new Map();

      // Hover label: temporary, one-at-a-time
      let hoverRevealedLabelId = null;
      let hoverRevealedLabelMeta = null;
      let hoverRevealedEdgeId = null;
      let hoverRevealedNodeId = null;

      // Right-click persistent labels
      const persistentRevealedLabels = new Map(); // labelId -> meta

      const selectedEdges = new Set();
      const highlightedEdges = new Set();
      const selectedNodes = new Set();

      // Tracking each node/edge's state as an object.
      const objectState = {
        nodes: new Map(), // nodeId -> "hidden" | "inspected"
        edges: new Map()  // edgeId -> "hidden" | "inspected" | "selected"
      };
      const objectIntervals = {
        nodes: new Map(), // nodeId -> { visible_since_ms, visible_intervals_ms: [] }
        edges: new Map()  // edgeId -> { visible_since_ms, visible_intervals_ms: [], selected_since_ms, selected_intervals_ms: [] }
      };
      for (const n of nodes) {
        objectState.nodes.set(n.id, trial.labels_visible_by_default ? "inspected" : "hidden");
        objectIntervals.nodes.set(n.id, {
          visible_since_ms: trial.labels_visible_by_default ? 0 : null,
          visible_intervals_ms: []
        });
      }
      for (const e of edges) {
        const eid = canonicalEdgeId(e.u, e.v);
        objectState.edges.set(eid, trial.labels_visible_by_default ? "inspected" : "hidden");
        objectIntervals.edges.set(eid, {
          visible_since_ms: trial.labels_visible_by_default ? 0 : null,
          visible_intervals_ms: [],
          selected_since_ms: null,
          selected_intervals_ms: []
        });
      }

      // Old event log
      const eventLog = [];
      const t0 = performance.now();
      //const nowMs = () => performance.now() - t0;
      const logEvent = (type, payload) => {
        if (!trial.record_event_log) return;
        eventLog.push({ t_ms: nowMs(), type, ...payload });
      };


      // Three-state left-clicks mode
      function nowMs() {
        return performance.now() - trialStartTime;
      }

      function logStateTransition({
        kind,          // "node" | "edge"
        object_id,     // node id or canonical edge id
        from_state,
        to_state,
        cause,
        extra = {}
      }) {
        if (!trial.record_event_log) return;

        eventLog.push({
          type: "object_state_change",
          t_ms: nowMs(),
          kind,
          object_id,
          from_state,
          to_state,
          cause,
          label_visible_after: (to_state === "inspected" || to_state === "selected"),
          selected_after: (kind === "edge" ? to_state === "selected" : null),
          ...extra
        });
      }
      function logRouteSnapshot(cause = "unknown") {
        if (!trial.record_event_log || !trial.record_route_snapshots) return;

        let selected_edges_snapshot = Array.from(selectedEdges);
        let highlighted_edges_snapshot = Array.from(highlightedEdges);
        let highlighted_nodes_snapshot = [];

        if (effectiveEnableThreeStateLeftClick) {
          selected_edges_snapshot = [];
          highlighted_edges_snapshot = [];
          highlighted_nodes_snapshot = [];

          for (const [eid, s] of objectState.edges.entries()) {
            if (s === "selected") selected_edges_snapshot.push(eid);
            if (s === "inspected") highlighted_edges_snapshot.push(eid);
          }

          for (const [nid, s] of objectState.nodes.entries()) {
            if (s === "inspected") highlighted_nodes_snapshot.push(nid);
          }
        }

        eventLog.push({
          type: "route_snapshot",
          t_ms: nowMs(),
          cause,
          selected_edges: selected_edges_snapshot,
          highlighted_edges: highlighted_edges_snapshot,
          highlighted_nodes: highlighted_nodes_snapshot
        });
      }
      function openVisibleInterval(kind, objectId, tMs) {
        const rec = objectIntervals[kind + "s"].get(objectId);
        if (!rec) return;
        if (rec.visible_since_ms == null) rec.visible_since_ms = tMs;
      }
      function closeVisibleInterval(kind, objectId, tMs) {
        const rec = objectIntervals[kind + "s"].get(objectId);
        if (!rec) return;
        if (rec.visible_since_ms != null) {
          rec.visible_intervals_ms.push(Math.max(0, tMs - rec.visible_since_ms));
          rec.visible_since_ms = null;
        }
      }
      function openSelectedInterval(edgeId, tMs) {
        const rec = objectIntervals.edges.get(edgeId);
        if (!rec) return;
        if (rec.selected_since_ms == null) rec.selected_since_ms = tMs;
      }
      function closeSelectedInterval(edgeId, tMs) {
        const rec = objectIntervals.edges.get(edgeId);
        if (!rec) return;
        if (rec.selected_since_ms != null) {
          rec.selected_intervals_ms.push(Math.max(0, tMs - rec.selected_since_ms));
          rec.selected_since_ms = null;
        }
      }
      function applyObjectState(kind, objectId, newState, cause = "three_state_click", extra = {}) {
        const store = objectState[kind + "s"];
        const oldState = store.get(objectId);
        if (oldState === newState) return false;

        const tMs = nowMs();

        // close intervals for old state
        if (oldState === "inspected" || oldState === "selected") {
          closeVisibleInterval(kind, objectId, tMs);
        }
        if (kind === "edge" && oldState === "selected") {
          closeSelectedInterval(objectId, tMs);
          selectedEdges.delete(objectId);
        }

        // apply new state
        store.set(objectId, newState);

        // open intervals for new state
        if (newState === "inspected" || newState === "selected") {
          openVisibleInterval(kind, objectId, tMs);
        }
        if (kind === "edge" && newState === "selected") {
          selectedEdges.add(objectId);
          openSelectedInterval(objectId, tMs);
        }

        // keep your existing selected-node recomputation
        recomputeSelectedNodes();

        logStateTransition({
          kind,
          object_id: objectId,
          from_state: oldState,
          to_state: newState,
          cause,
          extra
        });

        updateStyles();
        if (kind === "edge") logRouteSnapshot(cause);
        return true;
      }
      function getNextNodeState(nodeId) {
        const cur = objectState.nodes.get(nodeId) || "hidden";
        return (cur === "hidden") ? "inspected" : "hidden";
      }

      function getNextEdgeState(edgeId) {
        const cur = objectState.edges.get(edgeId) || "hidden";
        if (cur === "hidden") return "inspected";
        if (cur === "inspected") return "selected";
        return "hidden";
      }






      // For label-dragging with left-click.
      const draggedLabelOffsets = new Map(); // labelId -> {x, y}

      let activeLabelDrag = null; // {groupEl, labelId, startMouseSvgX, startMouseSvgY, startOffsetX, startOffsetY, didDrag}
      let pendingLabelDrag = null;  
      let recentlyFinishedLabelDrag = null;

      function getMouseSvgPoint(ev) {
        const rect = svg.getBoundingClientRect();
        const x = (ev.clientX - rect.left) * (trial.width / rect.width);
        const y = (ev.clientY - rect.top) * (trial.height / rect.height);
        return { x, y };
      }

      function applyLabelTransform(groupEl) {
        const ax = parseFloat(groupEl.dataset.anchorX || "0");
        const ay = parseFloat(groupEl.dataset.anchorY || "0");
        const ox = parseFloat(groupEl.dataset.offsetX || "0");
        const oy = parseFloat(groupEl.dataset.offsetY || "0");
        groupEl.setAttribute("transform", `translate(${ax + ox}, ${ay + oy})`);
      }


      function resetAllLabelOffsets() {
        draggedLabelOffsets.clear();
        const groups = gLabels.querySelectorAll(".itg-label-box");
        groups.forEach((groupEl) => {
          groupEl.dataset.offsetX = "0";
          groupEl.dataset.offsetY = "0";
          applyLabelTransform(groupEl);
          if (!groupEl.classList.contains("itg-label-hidden")) {
            clampLabelGroupToSvgCanvas(groupEl);
          }
        });
      }

      function attachLabelDragHandlers(groupEl, labelDomId) {
  if (!effectiveEnableDragLabels) return;

  groupEl.dataset.offsetX = groupEl.dataset.offsetX || "0";
  groupEl.dataset.offsetY = groupEl.dataset.offsetY || "0";

  const grip = groupEl.querySelector(".itg-label-grip");
  const labelBody = groupEl.querySelector(".itg-label-html");

  // If drag_whole_label is true, the label body can both click-toggle and drag.
  // We differentiate them by movement threshold.
  const dragHandle = trial.drag_whole_label ? labelBody : grip;
  if (!dragHandle) return;

  // Important for touch/pen/pointer dragging:
  // prevents browser pan/zoom gestures from hijacking the drag.
  dragHandle.style.touchAction = "none";

  function beginPendingDrag(ev) {
    if (!effectiveEnableDragLabels) return;
    if (groupEl.classList.contains("itg-label-hidden")) return;

    // Only respond to primary-button/primary-contact interactions.
    // For mouse: button 0 = left click.
    // For touch/pen: button is often 0 or -1 depending on browser; isPrimary is the main filter.
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    if (ev.isPrimary === false) return;

    ev.preventDefault();
    ev.stopPropagation();

    // Capture this pointer so dragging keeps working even if the pointer leaves the label.
    if (typeof dragHandle.setPointerCapture === "function") {
      try {
        dragHandle.setPointerCapture(ev.pointerId);
      } catch (err) {
        // ignore capture failures
      }
    }

    const p = getMouseSvgPoint(ev);
    pendingLabelDrag = {
      pointerId: ev.pointerId,
      groupEl,
      labelId: labelDomId,
      startMouseSvgX: p.x,
      startMouseSvgY: p.y,
      startOffsetX: parseFloat(groupEl.dataset.offsetX || "0"),
      startOffsetY: parseFloat(groupEl.dataset.offsetY || "0")
    };
  }

  function continuePointerDrag(ev) {
    // If already dragging, continue only for the same pointer.
    if (activeLabelDrag) {
      if (ev.pointerId !== activeLabelDrag.pointerId) return;

      ev.preventDefault();

      const p = getMouseSvgPoint(ev);
      const dx = p.x - activeLabelDrag.startMouseSvgX;
      const dy = p.y - activeLabelDrag.startMouseSvgY;

      const svgRect = svg.getBoundingClientRect();
      const dxPx = dx * (svgRect.width / trial.width);
      const dyPx = dy * (svgRect.height / trial.height);
      const movedPx = Math.hypot(dxPx, dyPx);

      if (movedPx >= trial.label_drag_threshold_px) {
        activeLabelDrag.didDrag = true;
      }

      if (!activeLabelDrag.didDrag) return;

      const newOx = activeLabelDrag.startOffsetX + dx;
      const newOy = activeLabelDrag.startOffsetY + dy;

      activeLabelDrag.groupEl.dataset.offsetX = String(newOx);
      activeLabelDrag.groupEl.dataset.offsetY = String(newOy);
      applyLabelTransform(activeLabelDrag.groupEl);
      return;
    }

    // Otherwise, see whether a pending press becomes a drag.
    if (!pendingLabelDrag) return;
    if (ev.pointerId !== pendingLabelDrag.pointerId) return;

    const p = getMouseSvgPoint(ev);
    const dx = p.x - pendingLabelDrag.startMouseSvgX;
    const dy = p.y - pendingLabelDrag.startMouseSvgY;

    const svgRect = svg.getBoundingClientRect();
    const dxPx = dx * (svgRect.width / trial.width);
    const dyPx = dy * (svgRect.height / trial.height);
    const movedPx = Math.hypot(dxPx, dyPx);

    if (movedPx < trial.label_drag_threshold_px) return;

    ev.preventDefault();

    // Threshold crossed: convert pending press into an active drag.
    activeLabelDrag = {
      pointerId: pendingLabelDrag.pointerId,
      groupEl: pendingLabelDrag.groupEl,
      labelId: pendingLabelDrag.labelId,
      startMouseSvgX: pendingLabelDrag.startMouseSvgX,
      startMouseSvgY: pendingLabelDrag.startMouseSvgY,
      startOffsetX: pendingLabelDrag.startOffsetX,
      startOffsetY: pendingLabelDrag.startOffsetY,
      didDrag: true
    };
    pendingLabelDrag = null;

    gLabels.appendChild(activeLabelDrag.groupEl);
    activeLabelDrag.groupEl.classList.add("dragging");

    const newOx = activeLabelDrag.startOffsetX + dx;
    const newOy = activeLabelDrag.startOffsetY + dy;

    activeLabelDrag.groupEl.dataset.offsetX = String(newOx);
    activeLabelDrag.groupEl.dataset.offsetY = String(newOy);
    applyLabelTransform(activeLabelDrag.groupEl);
  }

  function endPointerDrag(ev) {
    // Finish real drag
    if (activeLabelDrag && ev.pointerId === activeLabelDrag.pointerId) {
      const drag = activeLabelDrag;
      activeLabelDrag = null;

      drag.groupEl.classList.remove("dragging");

      clampLabelGroupToSvgCanvas(drag.groupEl);

      const ox = parseFloat(drag.groupEl.dataset.offsetX || "0");
      const oy = parseFloat(drag.groupEl.dataset.offsetY || "0");
      draggedLabelOffsets.set(drag.labelId, { x: ox, y: oy });

      logEvent("label_drag_end", {
        label_id: drag.labelId,
        offset_x: ox,
        offset_y: oy
      });

      instructionProgress.has_dragged_label = true;
      emitInstructionProgress();

      recentlyFinishedLabelDrag = drag.labelId;
      setTimeout(() => {
        if (recentlyFinishedLabelDrag === drag.labelId) {
          recentlyFinishedLabelDrag = null;
        }
      }, 0);

      if (typeof dragHandle.releasePointerCapture === "function") {
        try {
          if (dragHandle.hasPointerCapture && dragHandle.hasPointerCapture(ev.pointerId)) {
            dragHandle.releasePointerCapture(ev.pointerId);
          }
        } catch (err) {
          // ignore release failures
        }
      }

      return;
    }

    // Pending press ended without exceeding threshold -> not a drag.
    if (pendingLabelDrag && ev.pointerId === pendingLabelDrag.pointerId) {
      if (typeof dragHandle.releasePointerCapture === "function") {
        try {
          if (dragHandle.hasPointerCapture && dragHandle.hasPointerCapture(ev.pointerId)) {
            dragHandle.releasePointerCapture(ev.pointerId);
          }
        } catch (err) {
          // ignore release failures
        }
      }

      pendingLabelDrag = null;
    }
  }

  function cancelPointerDrag(ev) {
    if (activeLabelDrag && ev.pointerId === activeLabelDrag.pointerId) {
      activeLabelDrag.groupEl.classList.remove("dragging");
      activeLabelDrag = null;
    }

    if (pendingLabelDrag && ev.pointerId === pendingLabelDrag.pointerId) {
      pendingLabelDrag = null;
    }
  }

  dragHandle.addEventListener("pointerdown", beginPendingDrag);
  window.addEventListener("pointermove", continuePointerDrag, { passive: false });
  window.addEventListener("pointerup", endPointerDrag);
  window.addEventListener("pointercancel", cancelPointerDrag);

  // In grip-only mode, clicking the grip should never toggle the label target.
  if (!trial.drag_whole_label && grip) {
    grip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    grip.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
  }
}

        window.addEventListener("mousemove", (ev) => {
          if (!activeLabelDrag) return;

          const p = getMouseSvgPoint(ev);
          const dx = p.x - activeLabelDrag.startMouseSvgX;
          const dy = p.y - activeLabelDrag.startMouseSvgY;

          const svgRect = svg.getBoundingClientRect();
          const dxPx = dx * (svgRect.width / trial.width);
          const dyPx = dy * (svgRect.height / trial.height);
          const movedPx = Math.hypot(dxPx, dyPx);

          if (movedPx >= trial.label_drag_threshold_px) {
            activeLabelDrag.didDrag = true;
          }

          if (!activeLabelDrag.didDrag) return;

          const newOx = activeLabelDrag.startOffsetX + dx;
          const newOy = activeLabelDrag.startOffsetY + dy;

          activeLabelDrag.groupEl.dataset.offsetX = String(newOx);
          activeLabelDrag.groupEl.dataset.offsetY = String(newOy);
          applyLabelTransform(activeLabelDrag.groupEl);
        });

      

      function attachLabelToggleBehavior(groupEl, target) {
        if (!groupEl) return;
        if (!target) return;

        const labelBody = groupEl.querySelector(".itg-label-html");
        if (!labelBody) return;

        labelBody.addEventListener("click", (ev) => {
          if (!effectiveEnableThreeStateLeftClick) return;

          // In grip-only mode, label body click should toggle normally.
          // In whole-label mode, if a real drag just finished, do not toggle.
          if (recentlyFinishedLabelDrag && recentlyFinishedLabelDrag === groupEl.id) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }

          ev.preventDefault();
          ev.stopPropagation();

          if (target.kind === "node") {
            const nextState = getNextNodeState(target.node_id);
            applyObjectState("node", target.node_id, nextState, "label_left_click_three_state", {
              node_id: target.node_id,
              label_id: groupEl.id
            });
            return;
          }

          if (target.kind === "edge") {
            const eid = target.edge_id || canonicalEdgeId(target.u, target.v);
            const nextState = getNextEdgeState(eid);
            applyObjectState("edge", eid, nextState, "label_left_click_three_state", {
              edge_id: eid,
              u: target.u,
              v: target.v,
              label_id: groupEl.id
            });
          }
        });
      }

      // --- Hover timers ---
      let hoverShowTimer = null;
      let hoverHideTimer = null;
      const clearHoverTimers = () => {
        if (hoverShowTimer) {
          clearTimeout(hoverShowTimer);
          hoverShowTimer = null;
        }
        if (hoverHideTimer) {
          clearTimeout(hoverHideTimer);
          hoverHideTimer = null;
        }
      };

      function findNodeAtSvgPoint(svgX, svgY, nodeRadius = 12) {
        let bestNodeId = null;
        let bestDist = Infinity;

        for (const [nid, p] of Object.entries(pos)) {
          const d = Math.hypot(svgX - p.x, svgY - p.y);
          if (d <= nodeRadius && d < bestDist) {
            bestNodeId = nid;
            bestDist = d;
          }
        }
        return bestNodeId;
      }

      function findNearestNodeAtSvgPoint(px, py, maxDist = 18) {
        let bestNodeId = null;
        let bestDist = Infinity;

        for (const n of nodes) {
          const p = pos[n.id];
          if (!p) continue;

          const d = Math.hypot(px - p.x, py - p.y);
          if (d <= maxDist && d < bestDist) {
            bestDist = d;
            bestNodeId = n.id;
          }
        }

        return bestNodeId;
      }

      function findNearestEdgeAtSvgPoint(svgX, svgY, maxDist = trial.hover_edge_hit_width / 2) {
        let best = null;
        let bestDist = Infinity;
        let bestMidDist = Infinity;

        for (const e of edges) {
          if (!pos[e.u] || !pos[e.v]) continue;
          const x1 = pos[e.u].x, y1 = pos[e.u].y;
          const x2 = pos[e.v].x, y2 = pos[e.v].y;

          const d = pointToSegmentDistance(svgX, svgY, x1, y1, x2, y2);
          if (d > maxDist) continue;

          const md = edgeMidpointDistance(svgX, svgY, x1, y1, x2, y2);
          if (d < bestDist || (Math.abs(d - bestDist) < 1e-6 && md < bestMidDist)) {
            best = e;
            bestDist = d;
            bestMidDist = md;
          }
        }

        return best;
      }

      function resolveSpatialTargetAtSvgPoint(svgX, svgY) {
        const nodeId = findNearestNodeAtSvgPoint(svgX, svgY, 12);
        if (nodeId != null) {
          return {
            kind: "node",
            node_id: nodeId,
            key: `node:${nodeId}`
          };
        }

        const edge = findNearestEdgeAtSvgPoint(svgX, svgY, trial.hover_edge_hit_width / 2);
        if (edge) {
          const eid = canonicalEdgeId(edge.u, edge.v);
          return {
            kind: "edge",
            edge_id: eid,
            u: edge.u,
            v: edge.v,
            key: `edge:${eid}`
          };
        }

        return null;
      }

      function edgeContextMenuAction(e) {
        const eid = canonicalEdgeId(e.u, e.v);

        if (effectiveEnableRevealLabelsFinal && !trial.labels_visible_by_default) {
          const labelId = `label-edge-${domSafeId(eid)}`;
          const target = { kind: "edge", edge_id: eid, u: e.u, v: e.v };

          if (trial.allow_multiple_right_click_labels) {
            togglePersistentLabel(labelId, target, "right_click");
          } else {
            revealSingleRightClickLabel(labelId, target, "right_click");
          }
          return;
        }

        if (!effectiveEnableRevealLabelsFinal && effectiveEnableHighlightFinal) {
          if (highlightedEdges.has(eid)) highlightedEdges.delete(eid);
          else highlightedEdges.add(eid);
          updateStyles();
          logEvent("toggle_edge_highlight", {
            edge_id: eid,
            highlighted: highlightedEdges.has(eid),
            u: e.u,
            v: e.v
          });
        }
      }
      function edgeLeftClickAction(e) {
        const eid = canonicalEdgeId(e.u, e.v);
        if (shouldSuppressEdgeClickBecauseOfLabelDrag()) return;

        if (effectiveEnableThreeStateLeftClick) {
          const nextState = getNextEdgeState(eid);
          applyObjectState("edge", eid, nextState, "left_click_three_state", {
            edge_id: eid,
            u: e.u,
            v: e.v
          });
          return;
        }

        if (!effectiveEnableSelectEdges) return;

        if (selectedEdges.has(eid)) selectedEdges.delete(eid);
        else selectedEdges.add(eid);

        instructionProgress.has_selected_edge = true;
        emitInstructionProgress();

        recomputeSelectedNodes();
        updateStyles();
        logEvent("toggle_edge_select", {
          edge_id: eid,
          selected: selectedEdges.has(eid),
          u: e.u,
          v: e.v
        });
      }

      function finalizeObjectIntervals(trialEndMs) {
        for (const [nid, rec] of objectIntervals.nodes.entries()) {
          if (rec.visible_since_ms != null) {
            rec.visible_intervals_ms.push(Math.max(0, trialEndMs - rec.visible_since_ms));
            rec.visible_since_ms = null;
          }
        }

        for (const [eid, rec] of objectIntervals.edges.entries()) {
          if (rec.visible_since_ms != null) {
            rec.visible_intervals_ms.push(Math.max(0, trialEndMs - rec.visible_since_ms));
            rec.visible_since_ms = null;
          }
          if (rec.selected_since_ms != null) {
            rec.selected_intervals_ms.push(Math.max(0, trialEndMs - rec.selected_since_ms));
            rec.selected_since_ms = null;
          }
        }
      }

      function summarizeObjectIntervalsMsToSec() {
        const out = { nodes: {}, edges: {} };

        for (const [nid, rec] of objectIntervals.nodes.entries()) {
          out.nodes[nid] = {
            n_reveals: rec.visible_intervals_ms.length,
            total_visible_sec: rec.visible_intervals_ms.reduce((a, b) => a + b, 0) / 1000,
            visible_intervals_sec: rec.visible_intervals_ms.map(x => x / 1000),
            final_state: objectState.nodes.get(nid)
          };
        }

        for (const [eid, rec] of objectIntervals.edges.entries()) {
          out.edges[eid] = {
            n_reveals: rec.visible_intervals_ms.length,
            total_visible_sec: rec.visible_intervals_ms.reduce((a, b) => a + b, 0) / 1000,
            visible_intervals_sec: rec.visible_intervals_ms.map(x => x / 1000),
            n_selected_entries: rec.selected_intervals_ms.length,
            total_selected_sec: rec.selected_intervals_ms.reduce((a, b) => a + b, 0) / 1000,
            selected_intervals_sec: rec.selected_intervals_ms.map(x => x / 1000),
            final_state: objectState.edges.get(eid)
          };
        }

        return out;
      }

      // Geometric target currently under the cursor
      let cursorTargetEdgeId = null;
      let cursorTargetNodeId = null;

      // Target currently used by hover-reveal timing/state
      let hoverRevealTargetKey = null;

      // Visual glow target shown under the cursor
      let hoverGlowEdgeId = null;
      let hoverGlowNodeId = null;


      function updateSpatialCursor(ev) {
        if (!graphInteractive) return;

        const t = ev.target;

        // If hovering on a visible label, glow the corresponding node/edge.
        const labelBox = t && t.closest ? t.closest(".itg-label-box") : null;
        if (labelBox) {
          let nextGlowNodeId = null;
          let nextGlowEdgeId = null;

          const labelId = labelBox.id || "";

          if (labelId.startsWith("label-node-")) {
            for (const n of nodes) {
              if (`label-node-${domSafeId(n.id)}` === labelId) {
                nextGlowNodeId = n.id;
                break;
              }
            }
          } else if (labelId.startsWith("label-edge-")) {
            for (const e of edges) {
              const eid = canonicalEdgeId(e.u, e.v);
              if (`label-edge-${domSafeId(eid)}` === labelId) {
                nextGlowEdgeId = eid;
                break;
              }
            }
          }

          if (nextGlowNodeId !== hoverGlowNodeId || nextGlowEdgeId !== hoverGlowEdgeId) {
            hoverGlowNodeId = nextGlowNodeId;
            hoverGlowEdgeId = nextGlowEdgeId;
            updateStyles();
          }

          svg.style.cursor = "pointer";
          return;
        }

        const p = getMouseSvgPoint(ev);
        const target = resolveSpatialTargetAtSvgPoint(p.x, p.y);

        cursorTargetNodeId = (target && target.kind === "node") ? target.node_id : null;
        cursorTargetEdgeId = (target && target.kind === "edge") ? target.edge_id : null;

        const nodeClickable =
          !!cursorTargetNodeId && (
            effectiveEnableThreeStateLeftClick ||
            effectiveEnableRevealLabelsFinal ||
            effectiveEnableHoverReveal
          );

        const edgeClickable =
          !!cursorTargetEdgeId && (
            effectiveEnableThreeStateLeftClick ||
            effectiveEnableSelectEdges ||
            effectiveEnableRevealLabelsFinal ||
            effectiveEnableHoverReveal ||
            effectiveEnableHighlightFinal
          );

        const nextGlowNodeId = nodeClickable ? cursorTargetNodeId : null;
        const nextGlowEdgeId = (!nextGlowNodeId && edgeClickable) ? cursorTargetEdgeId : null;

        if (nextGlowNodeId !== hoverGlowNodeId || nextGlowEdgeId !== hoverGlowEdgeId) {
          hoverGlowNodeId = nextGlowNodeId;
          hoverGlowEdgeId = nextGlowEdgeId;
          updateStyles();
        }

        svg.style.cursor = (nodeClickable || edgeClickable) ? "pointer" : "";
      }

      function updateSpatialHoverReveal(ev) {
        if (!graphInteractive) return;
        if (!effectiveEnableHoverReveal) return;

        const p = getMouseSvgPoint(ev);
        const target = resolveSpatialTargetAtSvgPoint(p.x, p.y);
        const nextKey = target ? target.key : null;

        if (nextKey === hoverRevealTargetKey) return;

        clearHoverTimers();

        // Hide old hover-revealed label
        if (hoverRevealTargetKey != null) {
          const oldLabelId =
            hoverRevealTargetKey.startsWith("node:")
              ? `label-node-${domSafeId(hoverRevealTargetKey.slice(5))}`
              : `label-edge-${domSafeId(hoverRevealTargetKey.slice(5))}`;

          const doHide = () => {
            if (trial.labels_visible_by_default) return;
            if (hoverRevealedLabelId !== oldLabelId) return;
            hideHoverRevealedLabel("hover");
          };

          if (trial.hover_hide_delay_ms > 0) hoverHideTimer = setTimeout(doHide, trial.hover_hide_delay_ms);
          else doHide();
        }

        hoverRevealTargetKey = nextKey;

        if (target == null) return;

        const labelId =
          target.kind === "node"
            ? `label-node-${domSafeId(target.node_id)}`
            : `label-edge-${domSafeId(target.edge_id)}`;

        const doShow = () => {
          if (trial.labels_visible_by_default) return;
          if (persistentRevealedLabels.has(labelId)) return;

          if (hoverRevealedLabelId && hoverRevealedLabelId !== labelId) {
            hideHoverRevealedLabel("switch");
          }
          if (hoverRevealedLabelId === labelId) return;

          const meta =
            target.kind === "node"
              ? {
                  label_id: labelId,
                  kind: "node",
                  node_id: target.node_id,
                }
              : {
                  label_id: labelId,
                  kind: "edge",
                  edge_id: target.edge_id,
                  u: target.u,
                  v: target.v,
                };

          const didShow = showLabelElement(labelId, meta, "hover");
          if (!didShow) return;

          hoverRevealedLabelId = labelId;
          hoverRevealedLabelMeta = meta;

          if (target.kind === "node") {
            applyNodeRevealStyle(nodeDom.get(target.node_id));
            hoverRevealedNodeId = target.node_id;
            hoverRevealedEdgeId = null;
          } else {
            applyEdgeRevealStyle(edgeDom.get(target.edge_id));
            hoverRevealedEdgeId = target.edge_id;
            hoverRevealedNodeId = null;
          }
        };

        if (trial.hover_reveal_delay_ms > 0) hoverShowTimer = setTimeout(doShow, trial.hover_reveal_delay_ms);
        else doShow();
      }
function attachLabelBodyEventBlockers(labelBoxEl) {
  if (!labelBoxEl) return;

  const swallowClickOnly = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  labelBoxEl.addEventListener("click", (ev) => {
    const groupEl = labelBoxEl.closest(".itg-label-box");
    if (!groupEl) {
      swallowClickOnly(ev);
      return;
    }

    const labelDomId = groupEl.id || "";
    const isEdgeLabel = labelDomId.startsWith("label-edge-");

    // Allow left-click on revealed edge labels to toggle edge selection
    // in normal hover-reveal / select-edges mode.
    const canToggleEdgeFromLabel =
      isEdgeLabel &&
      effectiveEnableSelectEdges &&
      !effectiveEnableThreeStateLeftClick;

    if (!canToggleEdgeFromLabel) {
      swallowClickOnly(ev);
      return;
    }

    // Do not treat the mouseup after a label drag as an edge click.
    if (shouldSuppressEdgeClickBecauseOfLabelDrag()) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    // Recover the corresponding edge id from the label DOM id.
    // Safer to use stored meta when available.
    let meta =
      persistentRevealedLabels.get(labelDomId) ||
      (hoverRevealedLabelId === labelDomId ? hoverRevealedLabelMeta : null);

    let edgeId = null;
    if (meta && meta.kind === "edge" && meta.edge_id) {
      edgeId = meta.edge_id;
    } else {
      // Fallback: parse from DOM id
      edgeId = labelDomId.replace(/^label-edge-/, "");
    }

    if (!edgeId) {
      swallowClickOnly(ev);
      return;
    }

    const parts = edgeId.split("--");
    if (parts.length !== 2) {
      swallowClickOnly(ev);
      return;
    }

    const [u, v] = parts;
    edgeLeftClickAction({ u, v });

    ev.preventDefault();
    ev.stopPropagation();
  });

  labelBoxEl.addEventListener("dblclick", swallowClickOnly);

  labelBoxEl.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const groupEl = labelBoxEl.closest(".itg-label-box");
    if (!groupEl) return;
    const labelDomId = groupEl.id;

    if (!effectiveEnableThreeStateLeftClick) {
      if (persistentRevealedLabels.has(labelDomId)) {
        const meta = persistentRevealedLabels.get(labelDomId);
        hideLabelElement(labelDomId, meta, "label_right_click");
        persistentRevealedLabels.delete(labelDomId);
        clearRevealTargetStylingForTarget(meta);
      } else if (hoverRevealedLabelId === labelDomId) {
        hideHoverRevealedLabel("label_right_click");
      }
    }
  });
}


      // --- Reveal highlight styles ---
      const revealedEdgeIds = new Set();
      const revealedNodeIds = new Set();

      const applyEdgeRevealStyle = (line) => {
        if (!line) return;
        const eid = line.getAttribute("data-edge-id");
        if (eid != null) revealedEdgeIds.add(eid);
        updateStyles();
      };

      const clearEdgeRevealStyle = (line) => {
        if (!line) return;
        const eid = line.getAttribute("data-edge-id");
        if (eid != null) revealedEdgeIds.delete(eid);
        updateStyles();
      };

      const applyNodeRevealStyle = (circ) => {
        if (!circ) return;
        const nid = circ.getAttribute("data-node-id");
        if (nid != null) revealedNodeIds.add(nid);
        updateStyles();
      };

      const clearNodeRevealStyle = (circ) => {
        if (!circ) return;
        const nid = circ.getAttribute("data-node-id");
        if (nid != null) revealedNodeIds.delete(nid);
        updateStyles();
      };

      function applyRevealTargetStyling(target) {
        if (!target) return;
        if (target.kind === "edge") {
          applyEdgeRevealStyle(edgeDom.get(target.edge_id));
        } else if (target.kind === "node") {
          applyNodeRevealStyle(nodeDom.get(target.node_id));
        }
      }

      function clearRevealTargetStylingForTarget(target) {
        if (!target) return;
        if (target.kind === "edge") {
          clearEdgeRevealStyle(edgeDom.get(target.edge_id));
        } else if (target.kind === "node") {
          clearNodeRevealStyle(nodeDom.get(target.node_id));
        }
      }

      const clearHoverRevealTargetStyling = () => {
        if (hoverRevealedEdgeId) {
          clearEdgeRevealStyle(edgeDom.get(hoverRevealedEdgeId));
          hoverRevealedEdgeId = null;
        }
        if (hoverRevealedNodeId) {
          clearNodeRevealStyle(nodeDom.get(hoverRevealedNodeId));
          hoverRevealedNodeId = null;
        }
      };

      function makeLabelMeta(labelDomId, target) {
        const meta = {
          label_id: labelDomId,
          kind: target?.kind || null,
        };

        if (target?.kind === "edge") {
          meta.edge_id = target.edge_id;
          if (target.u !== undefined) meta.u = target.u;
          if (target.v !== undefined) meta.v = target.v;
        } else if (target?.kind === "node") {
          meta.node_id = target.node_id;
        }

        return meta;
      }

      function getBadgePlacement(x, y, cx, cy) {
        const dx = x - cx;
        const dy = y - cy;
        let ang = Math.atan2(dy, dx); // -pi..pi

        // Convert to 0..2pi
        if (ang < 0) ang += 2 * Math.PI;

        const sector = Math.floor((ang + Math.PI / 8) / (Math.PI / 4)) % 8;

        // 0:right, 1:down-right, 2:down, 3:down-left, 4:left, 5:up-left, 6:up, 7:up-right
        if (sector === 0) return "below";
        if (sector === 1) return "below";
        if (sector === 2) return "below";
        if (sector === 3) return "below";
        if (sector === 4) return "below";
        if (sector === 5) return "above";
        if (sector === 6) return "above";
        return "above";
      }
      function getBadgeAttrsForPlacement(x, y, placement, offsetPx = 26) {
        if (placement === "above") {
          return {
            x: x,
            y: y - offsetPx,
            anchor: "middle",
            baseline: "auto",
          };
        }
        if (placement === "below") {
          return {
            x: x,
            y: y + offsetPx,
            anchor: "middle",
            baseline: "hanging",
          };
        }
        if (placement === "left") {
          return {
            x: x - offsetPx,
            y: y + 3,
            anchor: "end",
            baseline: "middle",
          };
        }
        // right
        return {
          x: x + offsetPx,
          y: y + 3,
          anchor: "start",
          baseline: "middle",
        };
      }

      function shouldSuppressEdgeClickBecauseOfLabelDrag() {
        return !!(
          (activeLabelDrag && activeLabelDrag.didDrag) ||
          recentlyFinishedLabelDrag
        );
      }

      function showLabelElement(labelDomId, meta, cause = "unknown") {
        const el = document.getElementById(labelDomId);
        if (!el) return false;
        if (!el.classList.contains("itg-label-hidden")) return false;

        const saved = draggedLabelOffsets.get(labelDomId);
        if (saved) {
          el.dataset.offsetX = String(saved.x);
          el.dataset.offsetY = String(saved.y);
        } else {
          el.dataset.offsetX = el.dataset.offsetX || "0";
          el.dataset.offsetY = el.dataset.offsetY || "0";
        }

        el.classList.remove("itg-label-hidden");
        gLabels.appendChild(el);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => clampLabelGroupToSvgCanvas(el));
        });

        if (meta && meta.kind === "node") {
          instructionProgress.has_revealed_node = true;
          if (cause === "hover") instructionProgress.has_hovered_node = true;
          emitInstructionProgress();   // important
        } else if (meta && meta.kind === "edge") {
          instructionProgress.has_revealed_edge = true;
          if (cause === "hover") instructionProgress.has_hovered_edge = true;
          emitInstructionProgress();   // important
        }

        logEvent("label_shown", { ...meta, trigger: cause });
        return true;
      }

      function hideLabelElement(labelDomId, meta, cause = "unknown") {
        const el = document.getElementById(labelDomId);
        if (!el) return false;
        if (el.classList.contains("itg-label-hidden")) return false;

        el.classList.add("itg-label-hidden");
        logEvent("label_hidden", { ...meta, trigger: cause });
        return true;
      }

      const hideHoverRevealedLabel = (cause = "unknown") => {
        if (!hoverRevealedLabelId) return null;

        const labelId = hoverRevealedLabelId;
        const meta = hoverRevealedLabelMeta ? { ...hoverRevealedLabelMeta } : null;

        if (meta) {
          hideLabelElement(labelId, meta, cause);
        }

        hoverRevealedLabelId = null;
        hoverRevealedLabelMeta = null;
        clearHoverRevealTargetStyling();
        return meta;
      };

      const hideAllPersistentLabels = (cause = "unknown") => {
        for (const [labelId, meta] of persistentRevealedLabels.entries()) {
          hideLabelElement(labelId, meta, cause);
          clearRevealTargetStylingForTarget(meta);
        }
        persistentRevealedLabels.clear();
      };

      const revealSingleRightClickLabel = (labelDomId, target = null, cause = "right_click") => {
        if (!labelDomId || !target) return false;

        const meta = makeLabelMeta(labelDomId, target);

        if (persistentRevealedLabels.has(labelDomId)) {
          const oldMeta = persistentRevealedLabels.get(labelDomId);
          hideLabelElement(labelDomId, oldMeta, "right_click_toggle");
          persistentRevealedLabels.delete(labelDomId);
          clearRevealTargetStylingForTarget(target);
          return false;
        }

        hideAllPersistentLabels("switch");
        hideHoverRevealedLabel("switch");

        const didShow = showLabelElement(labelDomId, meta, cause);
        if (didShow) {
          persistentRevealedLabels.set(labelDomId, meta);
          applyRevealTargetStyling(target);
        }
        return didShow;
      };

      const togglePersistentLabel = (labelDomId, target = null, cause = "right_click") => {
        if (!labelDomId || !target) return false;

        const meta = makeLabelMeta(labelDomId, target);

        if (persistentRevealedLabels.has(labelDomId)) {
          const oldMeta = persistentRevealedLabels.get(labelDomId);
          const didHide = hideLabelElement(labelDomId, oldMeta, cause);
          persistentRevealedLabels.delete(labelDomId);
          clearRevealTargetStylingForTarget(target);
          return didHide;
        } else {
          const didShow = showLabelElement(labelDomId, meta, cause);
          if (didShow) {
            persistentRevealedLabels.set(labelDomId, meta);
            applyRevealTargetStyling(target);
          }
          return didShow;
        }
      };

  
      // Background click / spatial edge targeting
      if (graphInteractive) {
        svg.addEventListener("mousemove", (ev) => {
          updateSpatialCursor(ev);
          updateSpatialHoverReveal(ev);
        });

        svg.addEventListener("mouseleave", (ev) => {
          cursorTargetEdgeId = null;
          cursorTargetNodeId = null;
          hoverRevealTargetKey = null;
          hoverGlowEdgeId = null;
          hoverGlowNodeId = null;
          svg.style.cursor = "";
          updateStyles();

          if (effectiveEnableHoverReveal) {
            clearHoverTimers();
            const doHide = () => {
              hideHoverRevealedLabel("hover");
            };
            if (trial.hover_hide_delay_ms > 0) hoverHideTimer = setTimeout(doHide, trial.hover_hide_delay_ms);
            else doHide();
          }
        });

        svg.addEventListener("click", (ev) => {
          const p = getMouseSvgPoint(ev);

          const nearestNodeId = findNearestNodeAtSvgPoint(p.x, p.y);
          if (nearestNodeId != null && effectiveEnableThreeStateLeftClick) {
            if (shouldSuppressEdgeClickBecauseOfLabelDrag()) return;
            const nextState = getNextNodeState(nearestNodeId);
            applyObjectState("node", nearestNodeId, nextState, "left_click_three_state", {
              node_id: nearestNodeId
            });
            ev.stopPropagation();
            return;
          }

          const nearestEdge = findNearestEdgeAtSvgPoint(p.x, p.y, trial.hover_edge_hit_width / 2);
          if (nearestEdge) {
            edgeLeftClickAction(nearestEdge);
            ev.stopPropagation();
            return;
          }

          if (effectiveEnableRevealLabelsFinal && !trial.labels_visible_by_default && !effectiveEnableThreeStateLeftClick) {
            hideHoverRevealedLabel("background_click");
            if (!trial.allow_multiple_right_click_labels) {
              hideAllPersistentLabels("background_click");
            }
          }
        });

        svg.addEventListener("contextmenu", (ev) => {
          if (effectiveEnableRevealLabelsFinal || effectiveEnableHighlightFinal) {
            ev.preventDefault();
          }

          // If right-click happened on a visible label body, close that label.
          const labelBox = ev.target && ev.target.closest ? ev.target.closest(".itg-label-box") : null;
          if (labelBox) {
            ev.stopPropagation();
            const labelDomId = labelBox.id || "";
            const meta = persistentRevealedLabels.get(labelDomId) || hoverRevealedLabelMeta;

            if (persistentRevealedLabels.has(labelDomId)) {
              const oldMeta = persistentRevealedLabels.get(labelDomId);
              hideLabelElement(labelDomId, oldMeta, "right_click_toggle");
              persistentRevealedLabels.delete(labelDomId);
              clearRevealTargetStylingForTarget(oldMeta);
              return;
            }

            if (hoverRevealedLabelId === labelDomId && hoverRevealedLabelMeta) {
              hideHoverRevealedLabel("right_click_toggle");
              return;
            }
          }

          const p = getMouseSvgPoint(ev);
          const nearestEdge = findNearestEdgeAtSvgPoint(p.x, p.y, trial.hover_edge_hit_width / 2);
          if (nearestEdge) {
            edgeContextMenuAction(nearestEdge);
            ev.stopPropagation();
          }
        });
      }

      // Wrap label width
      function sizeForeignObjectToContent(fo, div, maxW, maxH) {
        // First let the div lay itself out with only a max-width constraint
        div.style.maxWidth = `${maxW}px`;
        div.style.width = "fit-content";

        // Measure the actual rendered size
        const actualW = Math.min(maxW, Math.ceil(div.scrollWidth));
        const actualH = Math.min(maxH, Math.ceil(div.scrollHeight));

        fo.setAttribute("width", String(actualW));
        fo.setAttribute("height", String(actualH));
        fo.setAttribute("x", String(-actualW / 2));
        fo.setAttribute("y", String(-actualH / 2));
      }

      // --- Draw edges ---
      if (effectiveShowEdges) {
        for (const e of edges) {
          if (!pos[e.u] || !pos[e.v]) continue;
          const eid = canonicalEdgeId(e.u, e.v);

          // Visible line: visual only
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", String(pos[e.u].x));
          line.setAttribute("y1", String(pos[e.u].y));
          line.setAttribute("x2", String(pos[e.v].x));
          line.setAttribute("y2", String(pos[e.v].y));
          line.setAttribute("stroke", "#000");
          line.setAttribute("data-edge-id", eid);
          line.setAttribute("data-u", e.u);
          line.setAttribute("data-v", e.v);

          // Bolding edges
          const boldModeOn = alwaysBoldEdgeKeys.size > 0;
          const isAlwaysBold = alwaysBoldEdgeKeys.has(edgeKey(e.u, e.v));
          const isBest = bestEdgeSet.has(eid);
          let edgeClass = "itg-edge normal";
          if (boldModeOn) {
            if (isAlwaysBold) {
              edgeClass = "itg-edge best always-bold";
            } else {
              edgeClass = "itg-edge normal gray";
            }
          } else {
            edgeClass = `itg-edge ${isBest ? "best" : "normal"}`;
          }
          line.setAttribute("class", edgeClass);

          // Important: let the invisible hit line handle interaction instead
          line.style.pointerEvents = "none";

          gEdges.appendChild(line);
          edgeDom.set(eid, line);

          const needsEdgeHitTarget =
            effectiveEnableHoverReveal ||
            effectiveEnableSelectEdges ||
            effectiveEnableRevealLabelsFinal ||
            effectiveEnableHighlightFinal;

          if (needsEdgeHitTarget) {
            const hit = document.createElementNS(svgNS, "line");
            hit.setAttribute("x1", String(pos[e.u].x));
            hit.setAttribute("y1", String(pos[e.u].y));
            hit.setAttribute("x2", String(pos[e.v].x));
            hit.setAttribute("y2", String(pos[e.v].y));
            hit.setAttribute("stroke", "transparent");
            hit.setAttribute("stroke-width", String(trial.hover_edge_hit_width));
            hit.setAttribute("data-edge-id", eid);
            hit.setAttribute("data-u", e.u);
            hit.setAttribute("data-v", e.v);

            // Option B: keep geometry in DOM for cursor affordance if wanted,
            // but do NOT let DOM z-order decide which edge receives events.
            hit.style.pointerEvents = "none";

            gEdges.appendChild(hit);
          }


        }
      }
      // Recall probe edge drawing between the two inquired nodes.
      if (isRecallProbe && trial.recall_probe_show_candidate_edge) {
        const [u, v] = recallProbeNodes;
        if (pos[u] && pos[v]) {
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", String(pos[u].x));
          line.setAttribute("y1", String(pos[u].y));
          line.setAttribute("x2", String(pos[v].x));
          line.setAttribute("y2", String(pos[v].y));
          line.setAttribute("stroke", "#000");
          line.setAttribute("stroke-width", "3");
          line.setAttribute("opacity", "0.95");
          line.style.pointerEvents = "none";
          gEdges.appendChild(line);
        }
      }

      function buildAdjFromSelected(selectedEdgesSet) {
        const adj = new Map();
        for (const n of nodes) adj.set(n.id, []);

        for (const eid of selectedEdgesSet) {
          const [u, v] = eid.split("--");
          if (adj.has(u) && adj.has(v)) {
            adj.get(u).push(v);
            adj.get(v).push(u);
          }
        }
        return adj;
      }

      function validateSimplePath(selectedEdgesSet, startId, goalId) {
        if (selectedEdgesSet.size === 0) return { valid: false };

        const adj = buildAdjFromSelected(selectedEdgesSet);

        // Check connectivity via BFS
        const visited = new Set();
        const stack = [startId];

        while (stack.length > 0) {
          const cur = stack.pop();
          if (visited.has(cur)) continue;
          visited.add(cur);
          for (const nb of adj.get(cur)) {
            if (!visited.has(nb)) stack.push(nb);
          }
        }

        if (!visited.has(goalId)) {
          return { valid: false, reason: "no_path_start_to_goal" };
        }

        // Degree checks
        let deg1 = 0;
        for (const [node, neighbors] of adj.entries()) {
          const d = neighbors.length;
          if (d === 0) continue;

          if (node === startId || node === goalId) {
            if (d !== 1) return { valid: false, reason: "start_or_goal_degree_not_1" };
          } else {
            if (d === 1) deg1++;
            if (d > 2) return { valid: false, reason: "branching_detected" };
          }
        }

        return { valid: true };
      }

      function extractOrderedPath(selectedEdgesSet, startId) {
        const adj = buildAdjFromSelected(selectedEdgesSet);

        const path = [startId];
        let current = startId;
        let prev = null;

        while (true) {
          const neighbors = adj.get(current) || [];
          let next = null;

          for (const nb of neighbors) {
            if (nb !== prev) {
              next = nb;
              break;
            }
          }

          if (!next) break;

          path.push(next);
          prev = current;
          current = next;
        }

        return path;
      }

 function parseQuarantineRuleText(ruleText) {
  const result = {
    baseDays: 0,
    rules: []
  };

  if (!ruleText || typeof ruleText !== "string") {
    return result;
  }

  const lines = ruleText
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Base: X days
    let m = line.match(/^Base:\s*(\d+)\s*days?$/i);
    if (m) {
      result.baseDays = Number(m[1]);
      continue;
    }

    // If visited X: N days
    m = line.match(/^If\s+visited\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\d+)\s*days?$/i);
    if (m) {
      result.rules.push({
        type: "visited",
        nodeId: m[1],
        days: Number(m[2])
      });
      continue;
    }

    // If arrive from X: N days
    m = line.match(/^If\s+arrive\s+from\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\d+)\s*days?$/i);
    if (m) {
      result.rules.push({
        type: "arrive_from",
        nodeId: m[1],
        days: Number(m[2])
      });
      continue;
    }

    // If arrived from X: N days
    m = line.match(/^If\s+arrived\s+from\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\d+)\s*days?$/i);
    if (m) {
      result.rules.push({
        type: "arrive_from",
        nodeId: m[1],
        days: Number(m[2])
      });
      continue;
    }

    // Ignore lines like:
    // "Modifying rules:"
    // "(max days applied if multiple rules match)"
  }

  return result;
}

function computeQuarantineDays(node, visitedHistory) {
  const parsed = quarantineRuleCache.get(node.id) || { baseDays: 0, rules: [] };
  const triggeredDays = [];

  for (const rule of parsed.rules) {
    if (rule.type === "visited") {
      if (visitedHistory.includes(rule.nodeId)) {
        triggeredDays.push(rule.days);
      }
    } else if (rule.type === "arrive_from") {
      const prevNode = visitedHistory.length > 0
        ? visitedHistory[visitedHistory.length - 1]
        : null;
      if (prevNode === rule.nodeId) {
        triggeredDays.push(rule.days);
      }
    }
  }

  return triggeredDays.length ? Math.max(...triggeredDays) : parsed.baseDays;
}

function computeLoss(selectedEdgesSet) {
  const startId = problem.start;
  const goalId = problem.goal;

  const validation = validateSimplePath(selectedEdgesSet, startId, goalId);

  if (!validation.valid) {
    return {
      valid: false,
      loss: trial.invalid_submission_cost,
      components: null,
      reason: validation.reason
    };
  }

  const path = extractOrderedPath(selectedEdgesSet, startId);

  let totalTime = 0;
  let totalMoney = 0;
  let totalVirus = 0;

  const visitedHistory = [startId];

  const edgeMap = new Map();
  for (const e of edges) {
    edgeMap.set(canonicalEdgeId(e.u, e.v), e);
  }

  for (let i = 0; i < path.length - 1; i++) {
    const u = path[i];
    const v = path[i + 1];

    // edge cost/time
    const edge = edgeMap.get(canonicalEdgeId(u, v));
    if (edge) {
      if (edge.duration !== undefined) totalTime += edge.duration;
      if (edge.cost !== undefined) totalMoney += edge.cost;
    }

    // node cost/time/exposure upon ARRIVING at v
    const node = nodeById.get(v);
    if (node) {
      const qDays = computeQuarantineDays(node, visitedHistory);

      totalTime += qDays;

      if (trial.include_q_cost) {
        totalMoney += (node.q_cost_per_day || 0) * qDays;
      }

      if (trial.include_virus) {
        totalVirus += (node.virus || 0);
      }
    }

    // after evaluating arrival at v, add v into history
    visitedHistory.push(v);
  }

  const w = trial.loss_weights;
  const loss =
    w.time * totalTime +
    w.money * totalMoney +
    w.virus * totalVirus;

  return {
    valid: true,
    loss,
    components: {
      time: totalTime,
      money: totalMoney,
      virus: totalVirus,
      path
    }
  };
}

      // --- Draw nodes ---
      function getRecallNodeStroke(id) {
        return recallProbeNodeSet.has(id) ? "#000" : trial.recall_probe_gray_hex;
      }
      function getRecallNodeTextFill(id) {
        return recallProbeNodeSet.has(id) ? "#000" : trial.recall_probe_gray_hex;
      }
      function getRecallNodeOpacity(id) {
        return recallProbeNodeSet.has(id) ? "1.0" : "0.9";
      }
      if (trial.show_nodes) {
        for (const n of nodes) {
          if (!pos[n.id]) continue;

          const circ = document.createElementNS(svgNS, "circle");
          circ.setAttribute("cx", String(pos[n.id].x));
          circ.setAttribute("cy", String(pos[n.id].y));
          circ.setAttribute("r", "18");
          circ.setAttribute("fill", "#ffffff");
          circ.setAttribute("stroke", "#000000");
          circ.setAttribute("stroke-width", "2");
          circ.setAttribute("class", "itg-node");
          circ.setAttribute("data-node-id", n.id);
          if (isRecallProbe) {
            circ.setAttribute("stroke", getRecallNodeStroke(n.id));
            circ.setAttribute("fill", "#fff");
            circ.setAttribute("opacity", getRecallNodeOpacity(n.id));
            circ.style.pointerEvents = "none";
          }

          if (graphInteractive) {
            circ.addEventListener("contextmenu", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (effectiveEnableRevealLabelsFinal && !trial.labels_visible_by_default) {
                const labelId = `label-node-${domSafeId(n.id)}`;
                const target = { kind: "node", node_id: n.id };

                if (trial.allow_multiple_right_click_labels) {
                  togglePersistentLabel(labelId, target, "right_click");
                } else {
                  revealSingleRightClickLabel(labelId, target, "right_click");
                }
              }
            });

            circ.addEventListener("click", (ev) => {
              if (shouldSuppressEdgeClickBecauseOfLabelDrag()) return;

              if (effectiveEnableThreeStateLeftClick) {
                ev.preventDefault();
                ev.stopPropagation();
                const nextState = getNextNodeState(n.id);
                applyObjectState("node", n.id, nextState, "left_click_three_state", {
                  node_id: n.id
                });
              }
            });


          }

          gNodes.appendChild(circ);
          nodeDom.set(n.id, circ);

          // const txt = document.createElementNS(svgNS, "text");
          // txt.setAttribute("x", String(pos[n.id].x));
          // txt.setAttribute("y", String(pos[n.id].y + 4));
          // txt.setAttribute("text-anchor", "middle");
          // txt.setAttribute("font-size", "15");
          // txt.setAttribute("font-weight", "bold");
          // txt.textContent = getDisplayedCityName(n.id);
          // txt.style.pointerEvents = "none";
          // gNodes.appendChild(txt);

          // Although city names can still be longer than the node diameter, this makes display better.
          const txt = document.createElementNS(svgNS, "text");
          txt.setAttribute("x", String(pos[n.id].x));
          txt.setAttribute("y", String(pos[n.id].y + 4));
          txt.setAttribute("text-anchor", "middle");
          txt.setAttribute("font-size", "13");
          txt.setAttribute("font-weight", "700");
          txt.setAttribute("fill", isRecallProbe ? getRecallNodeTextFill(n.id) : "#333");
          txt.setAttribute("stroke", "white");
          txt.setAttribute("stroke-width", "3");
          txt.setAttribute("paint-order", "stroke");
          txt.setAttribute("stroke-linejoin", "round");
          txt.textContent = getDisplayedCityName(n.id);
          txt.style.pointerEvents = "none";
          if (isRecallProbe) {
            txt.setAttribute("stroke", "white");
            txt.setAttribute("stroke-width", "3");
            txt.style.pointerEvents = "none";
          }
          gNodes.appendChild(txt);

          if (effectiveShowStartGoalBadges && (n.id === problem.start || n.id === problem.goal)) {
            const x = pos[n.id].x;
            const y = pos[n.id].y;

            // Use the SVG canvas center as the ring center
            const cx = trial.width / 2;
            const cy = trial.height / 2;

            const placement = getBadgePlacement(x, y, cx, cy);
            const attrs = getBadgeAttrsForPlacement(x, y, placement, 26);

            const badge = document.createElementNS(svgNS, "text");
            badge.setAttribute("x", String(attrs.x));
            badge.setAttribute("y", String(attrs.y));
            badge.setAttribute("text-anchor", attrs.anchor);
            badge.setAttribute("font-size", "14");
            badge.setAttribute("font-weight", "bold");

            // Better vertical alignment for left/right placements
            if (attrs.baseline === "middle") {
              badge.setAttribute("dominant-baseline", "middle");
            } else if (attrs.baseline === "hanging") {
              badge.setAttribute("dominant-baseline", "hanging");
            }

            const isStart = (n.id === problem.start);
            badge.textContent = isStart ? "START" : "GOAL";
            badge.setAttribute("fill", isStart ? "#FA7575" : "#73B827");

            // Optional white halo for readability
            badge.setAttribute("stroke", "white");
            badge.setAttribute("stroke-width", "2.5");
            badge.setAttribute("paint-order", "stroke");
            badge.setAttribute("stroke-linejoin", "round");

            badge.style.pointerEvents = "none";
            gNodes.appendChild(badge);
          }
        }
      }

      // --- Labels ---
      if (effectiveRenderHiddenLabels) {
        for (const n of nodes) {
          if (!pos[n.id]) continue;

          const maxW = trial.label_max_width_px;
          const maxH = trial.label_max_height_px;
          const ax = pos[n.id].x;
          const ay = pos[n.id].y;

          const labelHTML = buildNodeLabel(n, problem.start, problem.goal);
          const measured = measureLabelBox(labelHTML, maxW, maxH, true);
          const W = measured.width;
          const H = measured.height;

          const group = document.createElementNS(svgNS, "g");
          group.setAttribute("id", `label-node-${domSafeId(n.id)}`);
          group.setAttribute(
            "class",
            trial.labels_visible_by_default ? "itg-label-box" : "itg-label-box itg-label-hidden"
          );
          group.dataset.anchorX = String(ax);
          group.dataset.anchorY = String(ay);
          group.setAttribute("transform", `translate(${ax}, ${ay})`);

          const fo = document.createElementNS(svgNS, "foreignObject");
          fo.setAttribute("class", "itg-label-fo");
          fo.setAttribute("x", String(-W / 2));
          fo.setAttribute("y", String(-H / 2));
          fo.setAttribute("width", String(W));
          fo.setAttribute("height", String(H));

          const shell = document.createElement("div");
          shell.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
          shell.className = "itg-label-shell";
          
          const div = document.createElement("div");
          div.className = "itg-label-html";
          div.innerHTML = labelHTML;
          div.style.maxWidth = `${maxW}px`;
          div.style.maxHeight = `${maxH}px`;
          if (effectiveEnableDragLabels && trial.drag_whole_label) {
            div.style.cursor = "grab";
            div.title = "Drag label";
          }
          attachLabelBodyEventBlockers(div);

          let grip = null;
          if (effectiveEnableDragLabels && !trial.drag_whole_label) {
            grip = document.createElement("div");
            grip.className = "itg-label-grip";
            grip.title = "Drag label";
            shell.appendChild(grip);
          }
          shell.appendChild(div);

          fo.appendChild(shell);
          group.appendChild(fo);
          gLabels.appendChild(group);
          //addCornerGripToLabel(group, fo, W, H);
          attachLabelDragHandlers(group, `label-node-${domSafeId(n.id)}`);
          attachLabelToggleBehavior(group, {
            kind: "node",
            node_id: n.id
          });

          //sizeForeignObjectToContent(fo, div, W, H);
        }

        for (const e of edges) {
          if (!pos[e.u] || !pos[e.v]) continue;
          const eid = canonicalEdgeId(e.u, e.v);

          const maxW = trial.label_max_width_px;
          const maxH = trial.label_max_height_px;

          const x1 = pos[e.u].x, y1 = pos[e.u].y;
          const x2 = pos[e.v].x, y2 = pos[e.v].y;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;

          const labelText = buildEdgeLabel(e);
          const measured = measureLabelBox(labelText, maxW, maxH, true);
          const W = measured.width;
          const H = measured.height;

          const group = document.createElementNS(svgNS, "g");
          group.setAttribute("id", `label-edge-${domSafeId(eid)}`);
          group.setAttribute(
            "class",
            trial.labels_visible_by_default ? "itg-label-box" : "itg-label-box itg-label-hidden"
          );
          group.dataset.anchorX = String(mx);
          group.dataset.anchorY = String(my);
          group.setAttribute("transform", `translate(${mx}, ${my})`);

          const fo = document.createElementNS(svgNS, "foreignObject");
          fo.setAttribute("class", "itg-label-fo");
          fo.setAttribute("x", String(-W / 2));
          fo.setAttribute("y", String(-H / 2));
          fo.setAttribute("width", String(W));
          fo.setAttribute("height", String(H));


          const shell = document.createElement("div");
          shell.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
          shell.className = "itg-label-shell";

          const div = document.createElement("div");
          div.className = "itg-label-html";
          div.innerHTML = labelText;
          div.style.maxWidth = `${maxW}px`;
          div.style.maxHeight = `${maxH}px`;
          if (effectiveEnableDragLabels && trial.drag_whole_label) {
            div.style.cursor = "grab";
            div.title = "Drag label";
          }
          attachLabelBodyEventBlockers(div);

          let grip = null;
          if (effectiveEnableDragLabels && !trial.drag_whole_label) {
            grip = document.createElement("div");
            grip.className = "itg-label-grip";
            grip.title = "Drag label";
            shell.appendChild(grip);
          }
          shell.appendChild(div);
          fo.appendChild(shell);

          group.appendChild(fo);
          gLabels.appendChild(group);
          //addCornerGripToLabel(group, fo, W, H);
          attachLabelDragHandlers(group, `label-edge-${domSafeId(eid)}`);
          attachLabelToggleBehavior(group, {
            kind: "edge",
            edge_id: eid,
            u: e.u,
            v: e.v
          });
          //sizeForeignObjectToContent(fo, div, W, H);
        }
      }
      

      // --- Selection styling ---
      function recomputeSelectedNodes() {
        selectedNodes.clear();
        for (const eid of selectedEdges) {
          const line = edgeDom.get(eid);
          if (!line) continue;
          selectedNodes.add(line.getAttribute("data-u"));
          selectedNodes.add(line.getAttribute("data-v"));
        }
      }

      function syncHoverGlowToLabels() {
        // Clear old label glow
        for (const labelBox of gLabels.querySelectorAll(".itg-label-box.hover-target")) {
          labelBox.classList.remove("hover-target");
        }

        // Glow node label if it is the current hover target and is visible
        if (hoverGlowNodeId != null) {
          const nodeLabelId = `label-node-${domSafeId(hoverGlowNodeId)}`;
          const nodeLabelEl = document.getElementById(nodeLabelId);
          if (nodeLabelEl && !nodeLabelEl.classList.contains("itg-label-hidden")) {
            nodeLabelEl.classList.add("hover-target");
          }
        }

        // Glow edge label if it is the current hover target and is visible
        if (hoverGlowEdgeId != null) {
          const edgeLabelId = `label-edge-${domSafeId(hoverGlowEdgeId)}`;
          const edgeLabelEl = document.getElementById(edgeLabelId);
          if (edgeLabelEl && !edgeLabelEl.classList.contains("itg-label-hidden")) {
            edgeLabelEl.classList.add("hover-target");
          }
        }
      }
      function updateStyles() {
        const boldModeOn = alwaysBoldEdgeKeys.size > 0;

        for (const [eid, line] of edgeDom.entries()) {
          const u = line.getAttribute("data-u");
          const v = line.getAttribute("data-v");

          const isAlwaysBold = alwaysBoldEdgeKeys.has(edgeKey(u, v));
          const isBest = bestEdgeSet.has(eid);

          const edgeState = effectiveEnableThreeStateLeftClick
            ? (objectState.edges.get(eid) || "hidden")
            : null;

          const isSelected = effectiveEnableThreeStateLeftClick
            ? (edgeState === "selected")
            : selectedEdges.has(eid);

          const isHighlighted = highlightedEdges.has(eid);

          const isRevealed = effectiveEnableThreeStateLeftClick
            ? (edgeState === "inspected" || edgeState === "selected")
            : revealedEdgeIds.has(eid);

          const isHoverGlow = (hoverGlowEdgeId === eid);

          line.classList.remove("best", "normal", "always-bold", "gray", "selected", "highlighted", "hover-target");

          if (boldModeOn) {
            if (isAlwaysBold) {
              line.classList.add("best", "always-bold");
            } else {
              line.classList.add("normal", "gray");
            }
          } else {
            line.classList.add(isBest ? "best" : "normal");
          }

          if (isSelected) line.classList.add("selected");
          if (isHighlighted) line.classList.add("highlighted");
          if (isHoverGlow) line.classList.add("hover-target");

          let stroke = "";
          let strokeWidth = "";
          let opacity = "";

          if (isAlwaysBold) {
            stroke = trial.bold_path_string_color || "#1DE312";
          }

          if (isRevealed) {
            strokeWidth = "7px";
            opacity = "0.98";
          } else if (isHighlighted) {
            strokeWidth = "6px";
            opacity = "0.95";
          } else if (isAlwaysBold) {
            strokeWidth = String(trial.bold_path_string_edgewidth || 6);
            opacity = "0.9";
          } else {
            strokeWidth = "";
            opacity = "";
          }

          line.style.stroke = stroke;
          line.style.strokeWidth = strokeWidth;
          line.style.opacity = opacity;
        }

        for (const [nid, circ] of nodeDom.entries()) {
          const nodeState = effectiveEnableThreeStateLeftClick
            ? (objectState.nodes.get(nid) || "hidden")
            : null;

          const isSelected = selectedNodes.has(nid);

          const isRevealed = effectiveEnableThreeStateLeftClick
            ? (nodeState === "inspected")
            : revealedNodeIds.has(nid);

          const isHoverGlow = (hoverGlowNodeId === nid);

          if (isSelected) circ.classList.add("selected");
          else circ.classList.remove("selected");

          if (isHoverGlow) circ.classList.add("hover-target");
          else circ.classList.remove("hover-target");

          if (isRevealed) {
            circ.style.strokeWidth = "6px";
          } else {
            circ.style.strokeWidth = "";
          }
        }

        // sync label visibility from objectState in three-state mode
        if (effectiveEnableThreeStateLeftClick && !trial.labels_visible_by_default) {
          for (const n of nodes) {
            const nid = n.id;
            const labelId = `label-node-${domSafeId(nid)}`;
            const labelEl = document.getElementById(labelId);
            if (!labelEl) continue;

            const shouldShow = (objectState.nodes.get(nid) === "inspected");
            const isHidden = labelEl.classList.contains("itg-label-hidden");

            if (shouldShow && isHidden) {
              labelEl.classList.remove("itg-label-hidden");
              gLabels.appendChild(labelEl);
            } else if (!shouldShow && !isHidden) {
              labelEl.classList.add("itg-label-hidden");
            }
          }

          for (const e of edges) {
            const eid = canonicalEdgeId(e.u, e.v);
            const labelId = `label-edge-${domSafeId(eid)}`;
            const labelEl = document.getElementById(labelId);
            if (!labelEl) continue;

            const s = objectState.edges.get(eid);
            const shouldShow = (s === "inspected" || s === "selected");
            const isHidden = labelEl.classList.contains("itg-label-hidden");

            if (shouldShow && isHidden) {
              labelEl.classList.remove("itg-label-hidden");
              gLabels.appendChild(labelEl);
            } else if (!shouldShow && !isHidden) {
              labelEl.classList.add("itg-label-hidden");
            }
          }
        }

        syncHoverGlowToLabels();
      }
      recomputeSelectedNodes();
      updateStyles();

      if (trial.reveal_bold_path_labels_by_default && trial.bold_path_string) {
        revealLabelsAlongBoldPath(false);
      }

      function revealLabelsAlongBoldPath(reveal_start_label=false) {
        if (!trial.render_hidden_labels) return;

        // Reveal node labels along bold path
        for (const node of nodes) {
          if (!node || node.id == null) continue;
          if (!boldPathNodeSet.has(node.id)) continue;
          if( (!reveal_start_label) && (node.id==="StartTown")) continue; // Do not reveal the initial start point.

          const labelId = `label-node-${domSafeId(node.id)}`;
          const target = { kind: "node", node_id: node.id };
          const meta = makeLabelMeta(labelId, target);

          const el = document.getElementById(labelId);
          if (!el) continue;

          // If hidden, show it using the plugin's existing reveal helper
          if (el.classList.contains("itg-label-hidden")) {
            showLabelElement(labelId, meta, "bold_path_init");
          }

          // Keep track of it as a persistent visible label
          persistentRevealedLabels.set(labelId, meta);
        }

        // Reveal edge labels along bold path
        for (const e of edges) {
          const key = edgeKey(e.u, e.v);
          if (!boldPathEdgeKeySet.has(key)) continue;

          const eid = canonicalEdgeId(e.u, e.v);
          const labelId = `label-edge-${domSafeId(eid)}`;
          const target = { kind: "edge", edge_id: eid, u: e.u, v: e.v };
          const meta = makeLabelMeta(labelId, target);

          const el = document.getElementById(labelId);
          if (!el) continue;

          if (el.classList.contains("itg-label-hidden")) {
            showLabelElement(labelId, meta, "bold_path_init");
          }

          persistentRevealedLabels.set(labelId, meta);
        }
      }

      // --- Right column ---


      if (showRightPanel) {
        if (isRecallProbe) {
          const q = document.createElement("div");
          q.className = "itg-custom-hint";
          q.innerHTML = trial.recall_probe_question_html;
          q.style.fontSize = "22px";
          q.style.fontWeight = "700";
          q.style.lineHeight = "1.3";
          q.style.color = "#000";
          q.style.textAlign = "center";
          q.style.maxWidth = "320px";
          rightCol.appendChild(q);

          const btnRow = document.createElement("div");
          btnRow.style.display = "flex";
          btnRow.style.flexDirection = "row";
          btnRow.style.justifyContent = "center";
          btnRow.style.alignItems = "center";
          btnRow.style.gap = "50px";
          btnRow.style.marginTop = "20px";

          const yesBtn = document.createElement("button");
          yesBtn.className = "itg-btn";
          yesBtn.textContent = trial.recall_probe_yes_label || "Yes";
          const noBtn = document.createElement("button");
          noBtn.className = "itg-btn";
          noBtn.textContent = trial.recall_probe_no_label || "No";
          yesBtn.style.minWidth = "88px";
          noBtn.style.minWidth = "88px";
          yesBtn.style.fontSize = "16px";
          noBtn.style.fontSize = "16px";

          btnRow.appendChild(yesBtn);
          btnRow.appendChild(noBtn);
          rightCol.appendChild(btnRow);

          yesBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            recallProbeResponse = "yes";
            finish(false);
          });

          noBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            recallProbeResponse = "no";
            finish(false);
          });

        } else {

          const panelHint = document.createElement("div");
          panelHint.className = "itg-custom-hint";
          panelHint.innerHTML = trial.right_panel_hint_html;
          if (panelHint.innerHTML.length) {
            rightCol.appendChild(panelHint);
          }

          const hint = document.createElement("div");
          hint.className = "itg-hint";

          var hintBits = [];
          if ((!sandboxMode) && (trial.right_panel_hint_html == "")) {
            hintBits.push(`Total cost = (Flight money) + 100 × (Flight days + Quarantine days)`)
          }

                    if (trial.labels_visible_by_default) {
            hintBits.push("Labels are visible.");
          } else if (effectiveEnableThreeStateLeftClick) {
            hintBits.push("Left-click city: show/hide its info tag.");
            hintBits.push("Left-click flight: inspect -> select -> clear.");
          } else {
            if (effectiveEnableRevealLabelsFinal) {
              if (trial.allow_multiple_right_click_labels) {
                hintBits.push("Right-click city/flight/info tag: show/hide info tag.");
              } else {
                hintBits.push("Right-click node/edge: show label (click background hides).");
              }
            }
            if (effectiveEnableHoverReveal) {
              hintBits.push("Hover over city/flight: show info tag.");
            }
            if (effectiveEnableSelectEdges) {
              hintBits.push("Left-click flight: select/deselect it (green/black).");
            }
            if (!effectiveEnableRevealLabelsFinal && effectiveEnableHighlightFinal) {
              hintBits.push("Right-click edge: toggle highlight (thicker).");
            }
          }

          if (effectiveEnableDragLabels) {
            if(!trial.drag_whole_label){
              hintBits.push("Left-press on info tag's top-left corner: drag it.");

            } else {
              hintBits.push("Left-press on info tag: drag it.");
            }
          }

          hint.innerHTML = hintBits.length ? hintBits.join("<br>") : "";
          if (hint.innerHTML.length) rightCol.appendChild(hint);

          let clearBtn = null;
          if (effectiveShowClearButton || sandboxMode) {
            clearBtn = document.createElement("button");
            clearBtn.className = "itg-btn";
            clearBtn.textContent = trial.clear_button_label || "Clear all";
            rightCol.appendChild(clearBtn);


                        clearBtn.addEventListener("click", (ev) => {
              ev.preventDefault();

              if (effectiveEnableThreeStateLeftClick) {
                const tMs = nowMs();

                for (const [nid, s] of objectState.nodes.entries()) {
                  if (s !== "hidden") {
                    closeVisibleInterval("node", nid, tMs);
                    logStateTransition({
                      kind: "node",
                      object_id: nid,
                      from_state: s,
                      to_state: "hidden",
                      cause: "clear_all",
                      extra: { node_id: nid }
                    });
                    objectState.nodes.set(nid, "hidden");
                  }
                }

                for (const [eid, s] of objectState.edges.entries()) {
                  if (s === "selected") closeSelectedInterval(eid, tMs);
                  if (s !== "hidden") {
                    closeVisibleInterval("edge", eid, tMs);
                    const [u, v] = eid.split("--");
                    logStateTransition({
                      kind: "edge",
                      object_id: eid,
                      from_state: s,
                      to_state: "hidden",
                      cause: "clear_all",
                      extra: { edge_id: eid, u, v }
                    });
                    objectState.edges.set(eid, "hidden");
                  }
                }

                selectedEdges.clear();
                highlightedEdges.clear();
                recomputeSelectedNodes();
                updateStyles();
                resetAllLabelOffsets();
                logEvent("clear_all", {});
                logRouteSnapshot("clear_all");
                return;
              }

              selectedEdges.clear();
              highlightedEdges.clear();
              recomputeSelectedNodes();
              updateStyles();

              resetAllLabelOffsets();

              if (trial.clear_also_hides_label && !trial.labels_visible_by_default) {
                hideHoverRevealedLabel("clear");
                hideAllPersistentLabels("clear");
              }

              logEvent("clear_all", {});
            });
          }

          let btn = null;
          if (trial.require_continue_button || sandboxMode) {
            btn = document.createElement("button");
            btn.className = "itg-btn";
            btn.textContent = trial.button_label || "Submit";
            rightCol.appendChild(btn);

            if (enableSubmit) {
              btn.addEventListener("click", () => finish());
            } else {
              btn.disabled = true;
              btn.style.opacity = "0.6";
              btn.title = "Submit is disabled in this instruction widget.";
            }
          }
        }

          // keep your existing submit button / continue button code here unchanged
        
      }


        function recallProbeEdgeExists(problem, nodePair) {
        if (!problem || !Array.isArray(problem.edges) || !Array.isArray(nodePair) || nodePair.length !== 2) {
          return null;
        }
        const [a, b] = nodePair;
        const targetId = canonicalEdgeId(a, b);
        return problem.edges.some(e => canonicalEdgeId(e.u, e.v) === targetId);
      }

      let recallProbeResponse = null; // "yes" | "no" | null


            function computeInfoRevealSeconds(eventLog, nodes, edges, trialEndMs, labelsVisibleByDefault = false) {
        // Flat output object:
        //   node keys use original node ids, e.g. "D", "StartTown"
        //   edge keys use canonical edge ids, e.g. "D--StartTown", "G--I"
        const totalsMs = {};
        const openSinceMs = {};

        // Initialize all nodes
        for (const n of nodes) {
          totalsMs[n.id] = 0;
        }

        // Initialize all edges using canonical ids
        for (const e of edges) {
          const eid = canonicalEdgeId(e.u, e.v);
          totalsMs[eid] = 0;
        }

        // If labels are visible from the beginning, treat all labels as open at t=0
        if (labelsVisibleByDefault) {
          for (const key of Object.keys(totalsMs)) {
            openSinceMs[key] = 0;
          }
        }

        function getEventKey(ev) {
          if (!ev) return null;
          if (ev.kind === "node" && ev.node_id != null) return String(ev.node_id);
          if (ev.kind === "edge" && ev.edge_id != null) {
            // Re-canonicalize just in case
            if (typeof ev.u === "string" && typeof ev.v === "string") {
              return canonicalEdgeId(ev.u, ev.v);
            }
            return String(ev.edge_id);
          }
          return null;
        }

        function closeKeyAt(key, tMs) {
          if (key == null) return;
          if (!(key in openSinceMs)) return;
          const start = openSinceMs[key];
          const dt = Math.max(0, tMs - start);
          totalsMs[key] = (totalsMs[key] || 0) + dt;
          delete openSinceMs[key];
        }

        const events = Array.isArray(eventLog) ? eventLog.slice() : [];
        events.sort((a, b) => {
          const ta = (a && typeof a.t_ms === "number") ? a.t_ms : 0;
          const tb = (b && typeof b.t_ms === "number") ? b.t_ms : 0;
          return ta - tb;
        });

        for (const ev of events) {
          const tMs = (ev && typeof ev.t_ms === "number") ? ev.t_ms : 0;
          const key = getEventKey(ev);

          if (ev.type === "label_shown") {
            // Only open if not already open
            if (key != null && !(key in openSinceMs)) {
              openSinceMs[key] = tMs;
            }
          } else if (ev.type === "label_hidden") {
            closeKeyAt(key, tMs);
          } else if (ev.type === "clear_all") {
            // Usually redundant because your code logs label_hidden before clear_all,
            // but this makes the parser robust.
            for (const openKey of Object.keys(openSinceMs)) {
              closeKeyAt(openKey, tMs);
            }
          }
        }

        // If anything is still open at the end of the trial, close it at trialEndMs.
        for (const openKey of Object.keys(openSinceMs)) {
          closeKeyAt(openKey, trialEndMs);
        }

        // Convert ms -> sec
        const totalsSec = {};
        for (const [key, val] of Object.entries(totalsMs)) {
          totalsSec[key] = val / 1000;
        }

        return totalsSec;
      }
            function computeInfoRevealSecondsNested(
        eventLog,
        nodes,
        edges,
        trialEndMs,
        labelsVisibleByDefault = false
      ) {
        const totalsMs = {
          nodes: {},
          edges: {}
        };

        const openSinceMs = {
          nodes: {},
          edges: {}
        };

        // Initialize all nodes
        for (const n of nodes) {
          totalsMs.nodes[n.id] = 0;
        }

        // Initialize all edges using canonical ids
        for (const e of edges) {
          const eid = canonicalEdgeId(e.u, e.v);
          totalsMs.edges[eid] = 0;
        }

        // If all labels are visible from the beginning, start them at t=0
        if (labelsVisibleByDefault) {
          for (const nid of Object.keys(totalsMs.nodes)) {
            openSinceMs.nodes[nid] = 0;
          }
          for (const eid of Object.keys(totalsMs.edges)) {
            openSinceMs.edges[eid] = 0;
          }
        }

        function closeNodeAt(nodeId, tMs) {
          if (!(nodeId in openSinceMs.nodes)) return;
          const start = openSinceMs.nodes[nodeId];
          totalsMs.nodes[nodeId] += Math.max(0, tMs - start);
          delete openSinceMs.nodes[nodeId];
        }

        function closeEdgeAt(edgeId, tMs) {
          if (!(edgeId in openSinceMs.edges)) return;
          const start = openSinceMs.edges[edgeId];
          totalsMs.edges[edgeId] += Math.max(0, tMs - start);
          delete openSinceMs.edges[edgeId];
        }

        const events = Array.isArray(eventLog) ? eventLog.slice() : [];
        events.sort((a, b) => {
          const ta = (a && typeof a.t_ms === "number") ? a.t_ms : 0;
          const tb = (b && typeof b.t_ms === "number") ? b.t_ms : 0;
          return ta - tb;
        });

        for (const ev of events) {
          const tMs = (ev && typeof ev.t_ms === "number") ? ev.t_ms : 0;

          if (ev.type === "label_shown") {
            if (ev.kind === "node" && ev.node_id != null) {
              const nid = String(ev.node_id);
              if (!(nid in openSinceMs.nodes)) {
                openSinceMs.nodes[nid] = tMs;
              }
            } else if (ev.kind === "edge" && ev.edge_id != null) {
              const eid =
                (typeof ev.u === "string" && typeof ev.v === "string")
                  ? canonicalEdgeId(ev.u, ev.v)
                  : String(ev.edge_id);

              if (!(eid in openSinceMs.edges)) {
                openSinceMs.edges[eid] = tMs;
              }
            }
          }

          else if (ev.type === "label_hidden") {
            if (ev.kind === "node" && ev.node_id != null) {
              closeNodeAt(String(ev.node_id), tMs);
            } else if (ev.kind === "edge" && ev.edge_id != null) {
              const eid =
                (typeof ev.u === "string" && typeof ev.v === "string")
                  ? canonicalEdgeId(ev.u, ev.v)
                  : String(ev.edge_id);
              closeEdgeAt(eid, tMs);
            }
          }

          else if (ev.type === "clear_all") {
            // Robust fallback: close any labels still open at this moment
            for (const nid of Object.keys(openSinceMs.nodes)) {
              closeNodeAt(nid, tMs);
            }
            for (const eid of Object.keys(openSinceMs.edges)) {
              closeEdgeAt(eid, tMs);
            }
          }
        }

        // Close anything still visible at trial end / timeout
        for (const nid of Object.keys(openSinceMs.nodes)) {
          closeNodeAt(nid, trialEndMs);
        }
        for (const eid of Object.keys(openSinceMs.edges)) {
          closeEdgeAt(eid, trialEndMs);
        }

        // Convert ms -> sec
        const out = {
          nodes: {},
          edges: {}
        };

        for (const [nid, ms] of Object.entries(totalsMs.nodes)) {
          out.nodes[nid] = ms / 1000;
        }
        for (const [eid, ms] of Object.entries(totalsMs.edges)) {
          out.edges[eid] = ms / 1000;
        }

        return out;
      }


      function computeEdgeSelectedSeconds(
        eventLog,
        edges,
        trialEndMs,
        selectedEdgesAtFinish = null
      ) {
        const totalsMs = {};
        const openSinceMs = {};

        // Initialize all legal edges
        for (const e of edges) {
          const eid = canonicalEdgeId(e.u, e.v);
          totalsMs[eid] = 0;
        }

        function closeEdgeAt(edgeId, tMs) {
          if (!(edgeId in openSinceMs)) return;
          const start = openSinceMs[edgeId];
          totalsMs[edgeId] += Math.max(0, tMs - start);
          delete openSinceMs[edgeId];
        }

        const events = Array.isArray(eventLog) ? eventLog.slice() : [];
        events.sort((a, b) => {
          const ta = (a && typeof a.t_ms === "number") ? a.t_ms : 0;
          const tb = (b && typeof b.t_ms === "number") ? b.t_ms : 0;
          return ta - tb;
        });

        for (const ev of events) {
          if (ev.type !== "toggle_edge_select") continue;

          const tMs = (typeof ev.t_ms === "number") ? ev.t_ms : 0;
          const eid =
            (typeof ev.u === "string" && typeof ev.v === "string")
              ? canonicalEdgeId(ev.u, ev.v)
              : String(ev.edge_id);

          if (!(eid in totalsMs)) continue;

          if (ev.selected === true) {
            if (!(eid in openSinceMs)) {
              openSinceMs[eid] = tMs;
            }
          } else if (ev.selected === false) {
            closeEdgeAt(eid, tMs);
          }
        }

        // Fallback: if anything is still selected at finish, close at trial end
        for (const eid of Object.keys(openSinceMs)) {
          closeEdgeAt(eid, trialEndMs);
        }

        const out = {};
        for (const [eid, ms] of Object.entries(totalsMs)) {
          out[eid] = ms / 1000;
        }
        return out;
      }

      // --- Finish ---
      const finish = (isTimeout = false) => {
        let result = null;

        // =========================
        // Recall-probe mode finish
        // =========================
        if (isRecallProbe) {
          clearTimerIfNeeded();

          const queriedNodes = Array.isArray(trial.recall_probe_nodes)
            ? trial.recall_probe_nodes.slice(0, 2)
            : null;

          const trueEdgeExists = recallProbeEdgeExists(problem, queriedNodes);

          const responseBool =
            recallProbeResponse === "yes" ? true :
            recallProbeResponse === "no" ? false :
            null;

          const responseCorrect =
            (responseBool === null || trueEdgeExists === null)
              ? null
              : (responseBool === trueEdgeExists);

          const trialEndMs = performance.now() - trialStartTime;
          let object_state_summary = null;
          let info_reveal_seconds = null;
          let edge_selected_seconds = null;

          if (effectiveEnableThreeStateLeftClick) {
            finalizeObjectIntervals(trialEndMs);
            object_state_summary = summarizeObjectIntervalsMsToSec();

            info_reveal_seconds = {
              nodes: Object.fromEntries(
                Object.entries(object_state_summary.nodes).map(([k, v]) => [k, v.total_visible_sec])
              ),
              edges: Object.fromEntries(
                Object.entries(object_state_summary.edges).map(([k, v]) => [k, v.total_visible_sec])
              )
            };

            edge_selected_seconds = Object.fromEntries(
              Object.entries(object_state_summary.edges).map(([k, v]) => [k, v.total_selected_sec])
            );
          } else {
            info_reveal_seconds = computeInfoRevealSeconds(
              eventLog,
              nodes,
              edges,
              trialEndMs,
              !!trial.labels_visible_by_default
            );

            edge_selected_seconds = computeEdgeSelectedSeconds(
              eventLog,
              edges,
              trialEndMs,
              selectedEdges
            );
          }
          const trial_data = {
            // ---- general mode flags
            trial_mode: "recall_probe",

            // ---- preserve basic graph/layout context
            ring_order: ringOrder,
            node_pos: pos,
            event_log: trial.record_event_log ? eventLog : null,
          info_reveal_seconds: null,
          edge_selected_seconds: null,

            // ---- ordinary task-trial fields: placeholders
            selected_edges: null,
            highlighted_edges: null,

            valid_submission: null,
            loss: null,
            loss_time: null,
            loss_money: null,
            loss_virus: null,
            path: null,
            invalid_reason: null,

            invalid_submit_count_before_success: null,
            invalid_submit_count_never: null,
            invalid_submit_attempts: null,

            submitted_path_string: null,
            acceptable_paths_restriction_active: null,
            acceptable_paths_raw: null,
            acceptable_paths_displayed: null,
            submitted_path_matches_acceptable_path_label: null,

            bold_path_string: trial.bold_path_string ?? null,
            bold_path_string_displayed:
              trial.bold_path_string
                ? convertPathToDisplayedCityNames(trial.bold_path_string, trial.displayed_city_names)
                : null,

            // ---- recall-probe-specific columns
            recall_probe_nodes_raw: queriedNodes,
            recall_probe_nodes_displayed:
              queriedNodes
                ? queriedNodes.map(n => getDisplayedCityName(n))
                : null,
            recall_probe_question_html: trial.recall_probe_question_html ?? null,

            recall_probe_response: recallProbeResponse,     // "yes" | "no" | null
            recall_probe_response_asbool: responseBool,       // true | false | null
            recall_probe_true_edge_exists: trueEdgeExists,  // true | false | null
            recall_probe_response_iscorrect: responseCorrect, // true | false | null

            recall_probe_show_candidate_edge: !!trial.recall_probe_show_candidate_edge,
            recall_probe_timed_out_without_response: !!(isTimeout && recallProbeResponse === null),

            // ---- timing
            timed_out: isTimeout,
            elapsed_time_sec: getElapsedSec(),
            remaining_time_sec: trial.time_limit_sec != null ? getRemainingSec() : null,

            // Three-state left-click specific       
            three_state_left_click_enabled: !!effectiveEnableThreeStateLeftClick,
            object_state_summary: trial.record_state_transition_log ? object_state_summary : null,
            info_reveal_seconds: info_reveal_seconds,
            edge_selected_seconds: edge_selected_seconds,
          };

          display_element.innerHTML = "";
          hideWarningModal();
          this.jsPsych.finishTrial(trial_data);
          return;
        }

        // =========================
        // Normal task-trial finish
        // =========================
        if (!enableSubmit) return;

        if (isTimeout) {
          // On real timeout, the trial is ending, so clear timer now.
          clearTimerIfNeeded();

          if (!trial.labels_visible_by_default) {
            hideHoverRevealedLabel("finish");
            hideAllPersistentLabels("finish");
          }

          result = {
            valid: false,
            loss: trial.invalid_submission_cost,
            components: {
              time: trial.invalid_submission_cost,
              money: trial.invalid_submission_cost,
              virus: trial.invalid_submission_cost,
              path: null
            },
            reason: "timeout"
          };
        } else {
          result = computeLoss(selectedEdges);

          const submittedPathString = result && result.components
            ? pathArrayToArrowString(result.components.path)
            : null;

          const acceptableInfo = getAcceptablePathMatchInfo(
            submittedPathString,
            trial.acceptable_paths
          );

          // Case 1: usual invalid-path warning
          if (trial.require_simple_path && !result.valid) {
            recordInvalidSubmitAttempt("invalid_structure", result, acceptableInfo);

            // If acceptable-path mode is active, combine the message
            if (acceptableInfo.restriction_active) {
              showWarningModal(buildAcceptablePathsWarningMessage(result));
            } else {
              showWarningModal(
                "Your route must be a single continuous path from StartTown to GoalCity, without branches or loops."
              );
            }
            return;
          }

          // Case 2: path is structurally valid, but not in acceptable set
          if (acceptableInfo.restriction_active && !acceptableInfo.is_acceptable) {
            recordInvalidSubmitAttempt("not_acceptable_path", result, acceptableInfo);
            showWarningModal(buildAcceptablePathsWarningMessage(result));
            return;
          }

          // Only now are we really finishing the trial
          clearTimerIfNeeded();

          if (!trial.labels_visible_by_default) {
            hideHoverRevealedLabel("finish");
            hideAllPersistentLabels("finish");
          }
        }
        const trialEndMs = performance.now() - trialStartTime;

        let object_state_summary = null;
        let infoRevealSeconds = null;
        let edgeSelectedSeconds = null;
        let selectedEdgesForSave = Array.from(selectedEdges);
        let highlightedEdgesForSave = Array.from(highlightedEdges);
        let highlightedNodesForSave = [];

        if (effectiveEnableThreeStateLeftClick) {
          finalizeObjectIntervals(trialEndMs);
          object_state_summary = summarizeObjectIntervalsMsToSec();

          infoRevealSeconds = {
            nodes: Object.fromEntries(
              Object.entries(object_state_summary.nodes).map(([k, v]) => [k, v.total_visible_sec])
            ),
            edges: Object.fromEntries(
              Object.entries(object_state_summary.edges).map(([k, v]) => [k, v.total_visible_sec])
            )
          };

          edgeSelectedSeconds = Object.fromEntries(
            Object.entries(object_state_summary.edges).map(([k, v]) => [k, v.total_selected_sec])
          );

          selectedEdgesForSave = [];
          highlightedEdgesForSave = [];
          highlightedNodesForSave = [];

          for (const [eid, s] of objectState.edges.entries()) {
            if (s === "selected") selectedEdgesForSave.push(eid);
            if (s === "inspected") highlightedEdgesForSave.push(eid);
          }

          for (const [nid, s] of objectState.nodes.entries()) {
            if (s === "inspected") highlightedNodesForSave.push(nid);
          }
        } else {
          infoRevealSeconds = computeInfoRevealSecondsNested(
            eventLog,
            nodes,
            edges,
            trialEndMs,
            !!trial.labels_visible_by_default
          );

          edgeSelectedSeconds = computeEdgeSelectedSeconds(
            eventLog,
            edges,
            trialEndMs,
            selectedEdges
          );
        }

        const trial_data = {
          trial_mode: "task",

          ring_order: ringOrder,
          node_pos: pos,
          selected_edges: selectedEdgesForSave,
          highlighted_edges: highlightedEdgesForSave,
          highlighted_nodes: highlightedNodesForSave,
          event_log: trial.record_event_log ? eventLog : null,
          info_reveal_seconds: infoRevealSeconds,
          edge_selected_seconds: edgeSelectedSeconds,
          object_state_summary: trial.record_state_transition_log ? object_state_summary : null,
          three_state_left_click_enabled: !!effectiveEnableThreeStateLeftClick,

          valid_submission: result.valid,
          loss: result.loss,
          loss_time: result.components ? result.components.time : null,
          loss_money: result.components ? result.components.money : null,
          loss_virus: result.components ? result.components.virus : null,
          path: result.components ? result.components.path : null,
          invalid_reason: result.valid ? null : result.reason,

          timed_out: isTimeout,
          elapsed_time_sec: getElapsedSec(),
          remaining_time_sec: trial.time_limit_sec != null ? getRemainingSec() : null,

          invalid_submit_count_before_success: invalidSubmitCountBeforeSuccess,
          invalid_submit_count_never: invalidSubmitCountBeforeSuccess === 0,
          invalid_submit_attempts: invalidSubmitAttempts,

          submitted_path_string: result.components ? pathArrayToArrowString(result.components.path) : null,
          acceptable_paths_restriction_active:
            Array.isArray(trial.acceptable_paths) && trial.acceptable_paths.length > 0,
          acceptable_paths_raw:
            Array.isArray(trial.acceptable_paths) ? trial.acceptable_paths.slice() : null,
          acceptable_paths_displayed:
            Array.isArray(trial.acceptable_paths)
              ? trial.acceptable_paths.map(p => convertPathToDisplayedCityNames(p, trial.displayed_city_names))
              : null,
          submitted_path_matches_acceptable_path_label:
            (() => {
              const submittedPathString = result.components ? pathArrayToArrowString(result.components.path) : null;
              const info = getAcceptablePathMatchInfo(submittedPathString, trial.acceptable_paths);
              return info.restriction_active ? info.matched_index : null;
            })(),

          bold_path_string: trial.bold_path_string ?? null,
          bold_path_string_displayed:
            trial.bold_path_string
              ? convertPathToDisplayedCityNames(trial.bold_path_string, trial.displayed_city_names)
              : null,

          recall_probe_nodes_raw: null,
          recall_probe_nodes_displayed: null,
          recall_probe_question_html: null,
          recall_probe_response: null,
          recall_probe_response_bool: null,
          recall_probe_true_edge_exists: null,
          recall_probe_response_correct: null,
          recall_probe_show_candidate_edge: null,
          recall_probe_timed_out_without_response: null,
        };

        display_element.innerHTML = "";
        hideWarningModal();
        this.jsPsych.finishTrial(trial_data);
        
      };

    }
  }

  ItineraryGraphPlugin.info = info;
  return ItineraryGraphPlugin;
})(jsPsychModule);


if (!window.renderItineraryGraphStatic) {

  window.renderItineraryGraphStatic = function(container, config) {

    if (!window.jsPsychItineraryGraph) {
      throw new Error("Plugin must be loaded first.");
    }

    const plugin = new window.jsPsychItineraryGraph();

    // Fake jsPsych instance
    plugin.jsPsych = {
      finishTrial: function() {}
    };

    const trial = Object.assign({}, config);

    // Force display-only mode
    trial.show_right_panel = false;
    trial.interactive_graph = false;

    // Disable time logic
    trial.time_limit_sec = null;
    trial.force_end_on_timeout = false;

    // Render
    plugin.trial(container, trial);

    return {
      destroy: () => {
        container.innerHTML = "";
      }
    };
  };
}