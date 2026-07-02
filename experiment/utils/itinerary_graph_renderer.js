(function () {
  if (window.ItineraryGraphRenderer) return;

  const STATIC_DEFAULTS = {
    // layout
    ring_order: null,
    node_pos: null,
    displayed_city_names: null,
    radius: 220,
    center_x: 300,
    center_y: 300,
    width: 600,
    height: 600,

    // rendering
    show_nodes: true,
    show_edges: true,
    show_start_goal_badges: true,
    highlight_best_path: false,
    include_cityname: true,
    include_virus: true,
    include_q_cost: true,

    // labels
    bold_path_string: null,
    reveal_bold_path_labels_by_default: false,
    labels_visible_by_default: false,
    render_hidden_labels: true,
    enable_reveal_labels: true,
    allow_multiple_right_click_labels: true,
    enable_hover_reveal: false,
    hover_reveal_delay_ms: 0,
    hover_hide_delay_ms: 0,
    hover_edge_hit_width: 20,

    label_max_width_px: 300,
    label_max_height_px: 260,
    label_font_px: 12,
    label_line_height_px: 16,
    label_padding_px: 8,

    // interactions
    enable_select_edges: false,
    enable_highlight: false,
    enable_drag_labels: false,
    label_drag_threshold_px: 4,
    constrain_labels_to_canvas: false,
    label_drag_grip_size_px: 12,
    right_panel_hint_html: "",

    // trial flow
    prompt: "",
    button_label: "Submit",
    require_continue_button: false,
    show_clear_button: false,
    clear_button_label: "Clear everything",
    clear_also_hides_label: true,

    // timing
    time_limit_sec: null,
    force_end_on_timeout: false,
    show_countdown: false,

    // logging / evaluation
    record_event_log: false,
    require_simple_path: true,
    acceptable_paths: null,
    loss_weights: { time: 100, money: 1, virus: 0 },
    invalid_submission_cost: Infinity,

    // display / mode controls
    show_right_panel: false,
    interactive_graph: false,
    allow_allinteractions: false
  };

  function deepCloneLossWeights(value) {
    if (!value || typeof value !== "object") {
      return { time: 100, money: 1, virus: 0 };
    }
    return {
      time: value.time,
      money: value.money,
      virus: value.virus
    };
  }

  function buildTrialConfig(userConfig) {
    const cfg = Object.assign({}, STATIC_DEFAULTS, userConfig || {});

    // Avoid shared-object surprises
    cfg.loss_weights = deepCloneLossWeights(
      (userConfig && userConfig.loss_weights) || STATIC_DEFAULTS.loss_weights
    );

    // Static helper should never run countdown/timeout unless caller explicitly
    // opts into a true interactive trial outside this helper.
    if (!cfg.interactive_graph) {
      cfg.time_limit_sec = null;
      cfg.force_end_on_timeout = false;
      cfg.show_countdown = false;
      cfg.record_event_log = false;
    }

    // If caller wants a sandbox widget, preserve their requested panel/buttons.
    // Otherwise keep static-safe defaults.
    if (cfg.allow_allinteractions) {
      if (!("show_right_panel" in (userConfig || {}))) {
        cfg.show_right_panel = true;
      }
      if (!("show_clear_button" in (userConfig || {}))) {
        cfg.show_clear_button = true;
      }
      if (!("require_continue_button" in (userConfig || {}))) {
        cfg.require_continue_button = true;
      }
      if (!("enable_drag_labels" in (userConfig || {}))) {
        cfg.enable_drag_labels = true;
      }
    }

    return cfg;
  }

  window.ItineraryGraphRenderer = {
    render: function (container, config) {
      if (!container) {
        return null;
      }

      if (!window.jsPsychItineraryGraph) {
        throw new Error("jspsych-itinerary-graph must be loaded before renderer.");
      }

      const trial = buildTrialConfig(config);

      if (!trial.problem) {
        throw new Error("ItineraryGraphRenderer.render: config.problem is required.");
      }

      const plugin = new window.jsPsychItineraryGraph();

      // Minimal jsPsych stub for display-only rendering
      plugin.jsPsych = {
        finishTrial: function () {}
      };

      plugin.trial(container, trial);

      return {
        destroy: function () {
          if (container) {
            container.innerHTML = "";
          }
        }
      };
    }
  };

  window.renderItineraryGraphStatic = function (container, config) {
    if (!container) return null;
    return window.ItineraryGraphRenderer.render(container, config);
  };
})();