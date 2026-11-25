/* Experimenter-only settings. No participant controls or URL overrides. */
window.EXP1_CONFIG = {
  version: 'exp1_60s_risk_only_v1',
  mazeTrialDurationMs: 60000,
  // A planning estimate, not an empirical timing measurement. Update after piloting.
  estimatedSessionMinutes: '20–25',
  // Preserve the previous total base pay pending the payment discussion.
  basePayDollars: 4.00,
  addons: {
    orderMode: 'fixed',
    fixedOrder: ['risk']
  },
  risk: {
    interQuestionBlankMs: 500,      // blank between monetary questions
    mode: 'full31',                 // 'full31' or 'staircase5'
    // Original PSM: €300 vs €0; sure €0,€10,...,€300.
    // psm_usd450: same grid scaled/localized to $450; an adaptation.
    // gps_us: $450 vs $0; sure $15,$30,...,$465, exactly the US GPS tree.
    fullPreset: 'psm_usd450',        // 'psm_eur300', 'psm_usd450', or 'gps_us'
    staircasePreset: 'gps_us',      // use 'gps_us' for the attached questionnaire
    fullOrder: 'ascending',         // 'ascending' or 'random'
    gambleButtonSide: 'left'         // 'left' or 'random' (once per participant)
  }
};
