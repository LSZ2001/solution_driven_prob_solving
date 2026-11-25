/* jsPsych 6.3.1 post-maze risk questionnaire. */
(function (root) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  const shuffled = a => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  const range = n => Array.from({length: n}, (_, i) => i);
  function assert(ok, message) { if (!ok) throw new Error('EXP1 configuration: ' + message); }
  function validate(c) {
    assert(c && c.risk && c.addons, 'missing configuration');
    assert(Number.isFinite(c.basePayDollars) && c.basePayDollars >= 0, 'basePayDollars must be nonnegative');
    assert(Number.isFinite(c.mazeTrialDurationMs) && c.mazeTrialDurationMs > 0, 'maze deadline must be positive');
    assert(c.addons.orderMode === 'fixed', 'risk-only task order must be fixed');
    assert(Array.isArray(c.addons.fixedOrder) && c.addons.fixedOrder.length === 1 &&
      c.addons.fixedOrder[0] === 'risk', 'fixedOrder must contain only risk');
    assert(['full31','staircase5'].includes(c.risk.mode), 'risk mode must be full31 or staircase5');
    ['fullPreset','staircasePreset'].forEach(k => assert(['psm_eur300','psm_usd450','gps_us'].includes(c.risk[k]), 'unknown ' + k));
    assert(['ascending','random'].includes(c.risk.fullOrder), 'invalid fullOrder');
    assert(['left','random'].includes(c.risk.gambleButtonSide), 'invalid gambleButtonSide');
    assert(typeof c.estimatedSessionMinutes === 'string' && c.estimatedSessionMinutes.length > 0, 'estimatedSessionMinutes must be a nonempty string');
    assert(Number.isFinite(c.risk.interQuestionBlankMs) && c.risk.interQuestionBlankMs >= 0, 'invalid risk blank duration');
  }
  function riskGrid(preset) {
    if (preset === 'gps_us') return {preset, currency: 'USD', high: 450, low: 0, probability: .5, safe: range(31).map(i => (i + 1) * 15)};
    const high = preset === 'psm_eur300' ? 300 : 450;
    return {preset, currency: preset === 'psm_eur300' ? 'EUR' : 'USD', high, low: 0,
      probability: .5, safe: range(31).map(i => i * high / 30)};
  }
  function midpointIndex(lo, hi) { return Math.floor((lo + hi) / 2); }
  function riskSummary(rows, grid) {
    const sorted = rows.slice().sort((a,b) => a.risk_sure_amount - b.risk_sure_amount);
    const gamble = sorted.filter(x => x.risk_choice === 'gamble');
    const sure = sorted.filter(x => x.risk_choice === 'sure');
    const lower = gamble.length ? Math.max(...gamble.map(x => x.risk_sure_amount)) : null;
    const upper = sure.length ? Math.min(...sure.map(x => x.risk_sure_amount)) : null;
    const consistent = lower === null || upper === null || lower < upper;
    let transitions = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].risk_choice !== sorted[i-1].risk_choice) transitions++;
    const allObserved = sorted.length === grid.safe.length;
    return {
      risk_n_choices: rows.length, risk_gamble_count: gamble.length,
      risk_switch_count_observed: transitions, risk_monotonic_observed: consistent,
      risk_ce_lower: lower, risk_ce_upper: upper,
      risk_ce_censoring: !consistent ? 'inconsistent' : lower === null ? 'left' : upper === null ? 'right' : 'none',
      risk_ce_midpoint: consistent && lower !== null && upper !== null ? (lower + upper) / 2 : null,
      // For the staircase this is its 0..31 terminal category; for a full list
      // it is a switch category ONLY for monotonic responses.
      risk_threshold_category: consistent ? (lower === null ? 0 : grid.safe.indexOf(lower) + 1) : null,
      risk_consistency_assessable: allObserved,
      risk_ce_note: allObserved ? 'Full grid; inconsistent choices retain raw vector and gamble count.' : 'Adaptive path enforces consistency; cannot assess choice noise.'
    };
  }
  function buildRisk(jp, cfg) {
    const grid=riskGrid(cfg.mode === 'staircase5' ? cfg.staircasePreset : cfg.fullPreset);
    const count=cfg.mode === 'staircase5' ? 5 : grid.safe.length;
    const money=x => new Intl.NumberFormat('en-US',{style:'currency',currency:grid.currency,maximumFractionDigits:0}).format(x);
    const side=cfg.gambleButtonSide === 'random' ? (Math.random()<.5 ? 'left':'right') : 'left';
    const choices=side === 'left' ? ['gamble','sure'] : ['sure','gamble'];
    const order=cfg.fullOrder === 'random' ? shuffled(range(grid.safe.length)) : range(grid.safe.length);
    let lo=0,hi=grid.safe.length-1,currentIndex=null;
    const rows=[];
const timeline=[{type:'instructions',show_clickable_nav:true,data:{task:'risk',event:'risk_instructions'},pages:[
  `<div style="max-width:1200px; margin:0 auto;">
     <h1 style="font-size:36px;line-height:1.2;text-align:center;">Money choices</h1>

     <div style="text-align:left;">
       <p>In this task, you will repeatedly choose between two hypothetical options:</p>

       <ul>
         <li><b>receiving a fixed amount of money</b> for sure, or</li>
         <li><b>taking a random draw</b> with an equal chance of receiving ${money(grid.high)} or ${money(grid.low)}.</li>
       </ul>

       <p>You will make <b>${count} choices</b> in total. Across choices, the amount of the sure payment will change.

       <br>For each choice, please select the option that you would genuinely prefer if you were making the decision in real life.</p>

       <p>This task will take approximately <b>3 minutes.</b></p>

       <p>If you are ready, click "Next" to proceed to the task.</p>
     </div>
   </div>`
]}];
    for(let i=0;i<count;i++) {
      if(i>0 && cfg.interQuestionBlankMs>0) timeline.push({type:'html-keyboard-response',stimulus:'',choices:jp.NO_KEYS,trial_duration:cfg.interQuestionBlankMs,data:{task:'risk',event:'risk_inter_question_blank'}});
      timeline.push({type:'html-button-response',
      stimulus:() => {
        currentIndex=cfg.mode === 'staircase5' ? midpointIndex(lo,hi) : order[i];
        return `
          <p><b>Money choice ${i+1} of ${count}</b></p>
          <p>Which would you prefer?</p>
          <div style="text-align:left; max-width:900px; margin:0 auto;">
            <p><b>Draw:</b> 50% chance of ${money(grid.high)} and 50% chance of ${money(grid.low)}</p>
            <p><b>Sure payment:</b> ${money(grid.safe[currentIndex])}</p>
          </div>
        `;
        // return `<p><b>Money choice ${i+1} of ${count}</b></p><p>Which would you prefer?</p>
        //   <p><b>Draw:</b> 50% chance of ${money(grid.high)} and 50% chance of ${money(grid.low)}</p>
        //   <p><b>Sure payment:</b> ${money(grid.safe[currentIndex])}</p>`;
      }, choices:() => choices.map(x => x === 'gamble' ? 'Choose the draw' : 'Choose the sure payment'),
      data:{task:'risk',event:'risk_choice'},
      on_finish:data => {
        const choice=choices[Number(data.response)];
        Object.assign(data,{risk_mode:cfg.mode,risk_preset:grid.preset,risk_currency:grid.currency,
          risk_gamble_high:grid.high,risk_gamble_low:grid.low,risk_gamble_probability:grid.probability,
          risk_sure_amount:grid.safe[currentIndex],risk_grid_index:currentIndex,risk_choice_index:i,
          risk_choice:choice,risk_gamble_button_side:side,risk_search_lo_before:lo,risk_search_hi_before:hi});
        rows.push(clone(data));
        if(cfg.mode === 'staircase5') {
          if(choice === 'gamble') lo=currentIndex+1; else hi=currentIndex-1;
          data.risk_search_lo_after=lo; data.risk_search_hi_after=hi;
        }
      }});
    }
    // Radio response is discrete, required, and has no preselected default.
    timeline.push({type:'survey-html-form',data:{task:'risk',event:'risk_self_report'},preamble:
      '<p>How willing are you, in general, to take risks?</p><p>0 = completely unwilling to take risks<br>10 = very willing to take risks</p>',
      html:'<fieldset style="border:0;display:flex;gap:16px;justify-content:center">'+range(11).map(i =>
        `<label style="display:flex;flex-direction:column;gap:8px">${i}<input type="radio" name="risk_general" value="${i}" required></label>`).join('')+'</fieldset>',
      button_label:'Continue',on_finish:data => {
        const response=typeof data.response === 'string' ? JSON.parse(data.response) : data.response;
        data.risk_general_0_10=Number(response.risk_general);
        Object.assign(data,riskSummary(rows,grid),{risk_mode:cfg.mode,risk_preset:grid.preset,
          risk_grid_json:JSON.stringify(grid.safe),risk_choices_json:JSON.stringify(rows.map(x => ({sure:x.risk_sure_amount,choice:x.risk_choice,rt:x.rt}))),
          risk_currency:grid.currency,risk_gamble_high:grid.high});
      }});
    return timeline;
  }
  function build(jp,c) {
    validate(c);
    const order = c.addons.fixedOrder.slice();
    jp.data.addProperties({experiment_version:c.version,maze_deadline_ms:c.mazeTrialDurationMs,
      addon_order:order.join('_then_'),addon_order_mode:c.addons.orderMode,risk_assigned_mode:c.risk.mode,
      experiment_config_json:JSON.stringify(c)});
    const timeline=[{type:'html-button-response',choices:['Continue'],data:{task:'addons',event:'addons_transition'},stimulus:
      '<p><b>Congratulations on completing the jetty-paving game!</b></p><p>You will now complete <b>one additional task: money choices</b>, lasting approximately 3 minutes.</p><p>Your jetty-paving bonus has already been determined. These hypothetical choices will not change it.</p>'}];
    timeline.push(...buildRisk(jp, c.risk));
    return timeline;
  }
  root.Exp1Addons={build,validate,riskGrid,riskSummary,midpointIndex};
})(typeof window !== 'undefined' ? window : globalThis);
