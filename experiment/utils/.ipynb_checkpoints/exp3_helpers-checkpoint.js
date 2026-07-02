function makeRandomCityNameMapping(
  cityNames,
  displayedCityNames,
  fixedMappings = {},
  rng = Math.random
) {
  // Basic checks
  if (!Array.isArray(cityNames) || !Array.isArray(displayedCityNames)) {
    throw new Error("cityNames and displayedCityNames must both be arrays.");
  }

  const uniqueCities = [...new Set(cityNames)];
  const uniqueDisplayed = [...new Set(displayedCityNames)];

  if (uniqueCities.length !== cityNames.length) {
    throw new Error("cityNames contains duplicates.");
  }

  if (uniqueDisplayed.length !== displayedCityNames.length) {
    throw new Error("displayedCityNames contains duplicates.");
  }

  if (uniqueDisplayed.length < uniqueCities.length) {
    throw new Error("Not enough displayed city names for the number of cities.");
  }

  // Validate fixed mappings
  for (const [city, disp] of Object.entries(fixedMappings)) {
    if (!uniqueCities.includes(city)) {
      throw new Error(`Fixed mapping city "${city}" is not in cityNames.`);
    }
    if (!uniqueDisplayed.includes(disp)) {
      throw new Error(`Fixed mapping displayed name "${disp}" is not in displayedCityNames.`);
    }
  }

  const fixedCities = Object.keys(fixedMappings);
  const fixedDisplayed = Object.values(fixedMappings);

  if (new Set(fixedDisplayed).size !== fixedDisplayed.length) {
    throw new Error("fixedMappings assigns the same displayed city name to multiple cities.");
  }

  // Remaining cities and displayed names
  const remainingCities = uniqueCities.filter(c => !fixedCities.includes(c));
  const remainingDisplayed = uniqueDisplayed.filter(d => !fixedDisplayed.includes(d));

  if (remainingDisplayed.length < remainingCities.length) {
    throw new Error("After fixed mappings, not enough displayed city names remain.");
  }

  // Shuffle helper
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }


  const shuffledDisplayed = shuffle(remainingDisplayed);

  // Build final mapping
  const mapping = { ...fixedMappings };
  for (let i = 0; i < remainingCities.length; i++) {
    mapping[remainingCities[i]] = shuffledDisplayed[i];
  }

  return mapping;
}



    // =========================================================
    // Helpers: CSV loading
    // =========================================================
    function loadCSV(url) {
      return new Promise((resolve, reject) => {
        Papa.parse(url, {
          download: true,
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: function(results) {
            if (results.errors && results.errors.length > 0) {
              console.warn("PapaParse warnings/errors:", results.errors);
            }

            // Remove fully empty rows
            const cleaned = results.data.filter(row => {
              if (!row || typeof row !== "object") return false;
              return Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== "");
            });

            resolve(cleaned);
          },
          error: function(err) {
            reject(err);
          }
        });
      });
    }

    // =========================================================
    // Helpers: random sampling
    // =========================================================
    function makeRNG(seed = null) {
      if (seed === null || seed === undefined) {
        return Math.random;
      }

      let s = seed >>> 0;
      return function () {
        s += 0x6D2B79F5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function shuffleArray(arr, rng = Math.random) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }

    function sampleWithoutReplacement(arr, n, rng = Math.random) {
      if (n > arr.length) {
        throw new Error(`Cannot sample ${n} items from array of length ${arr.length}`);
      }
      return shuffleArray(arr, rng).slice(0, n);
    }

    function isTruthyOpt(x) {
      if (x === true || x === 1 || x === "1") return true;
      if (typeof x === "string" && x.trim().toLowerCase() === "true") return true;
      return false;
    }




    
function sampleCachedSolutionsAndTrials({
  dfRows,
  covidProblems,
  nTrials = 7,
  seed = null,
  trialIndexColumn = "trial_idx",
  pathLengthTag = "path[4]",
  balanceByPathComparison = true
}) {
  const rng = makeRNG(seed);

  if (!Array.isArray(dfRows) || dfRows.length === 0) {
    throw new Error("dfRows is empty or not an array.");
  }
  if (!Array.isArray(covidProblems) || covidProblems.length === 0) {
    throw new Error("covidProblems is empty or not an array.");
  }

  // Sample two cached solutions from unique(df["trial_best_path"])
  const uniquePaths = [...new Set(
    dfRows
      .map(r => r.trial_best_path)
      .filter(x => x !== null && x !== undefined && String(x).trim() !== "")
  )];

  if (uniquePaths.length < 2) {
    throw new Error("Need at least two unique trial_best_path values.");
  }

  const [p1, p2] = sampleWithoutReplacement(uniquePaths, 2, rng);

  const optCol1 = `is_opt::${pathLengthTag} ${p1}`;
  const optCol2 = `is_opt::${pathLengthTag} ${pathLengthTag ? p2 : p2}`; // kept structure simple below
  const lossCol1 = `loss::${pathLengthTag} ${p1}`;
  const lossCol2 = `loss::${pathLengthTag} ${p2}`;

  // Fix optCol2 in case you prefer symmetric style:
  // const optCol2 = `is_opt::${pathLengthTag} ${p2}`;

  // Keep only rows where both cached solutions are suboptimal
  const eligibleRows = dfRows.filter(row => {
    const isOpt1 = isTruthyOpt(row[optCol1]);
    const isOpt2 = isTruthyOpt(row[`is_opt::${pathLengthTag} ${p2}`]);
    return !isOpt1 && !isOpt2;
  });

  if (eligibleRows.length < nTrials) {
    throw new Error(
      `Only ${eligibleRows.length} eligible trials found, but nTrials=${nTrials}.`
    );
  }

  let sampledRows;

  if (!balanceByPathComparison) {
    // Original behavior
    sampledRows = sampleWithoutReplacement(eligibleRows, nTrials, rng);
  } else {
    // Split eligible rows by whether p1 is better or p2 is better
    const p1BetterRows = [];
    const p2BetterRows = [];

    for (const row of eligibleRows) {
      const loss1 = Number(row[lossCol1]);
      const loss2 = Number(row[lossCol2]);

      if (!Number.isFinite(loss1) || !Number.isFinite(loss2)) {
        continue; // skip malformed rows
      }

      if (loss1 < loss2) {
        p1BetterRows.push(row);
      } else if (loss1 > loss2) {
        p2BetterRows.push(row);
      }
      // ties are ignored for balancing
    }

    const basePerGroup = Math.floor(nTrials / 2);
    const extraToP1 = (nTrials % 2 === 1) ? (rng() < 0.5) : false;

    const nFromP1 = basePerGroup + (extraToP1 ? 1 : 0);
    const nFromP2 = basePerGroup + (!extraToP1 && nTrials % 2 === 1 ? 1 : 0);

    if (p1BetterRows.length < nFromP1 || p2BetterRows.length < nFromP2) {
      throw new Error(
        `Not enough balanced eligible trials. ` +
        `Need ${nFromP1} with ${lossCol1} < ${lossCol2} and ` +
        `${nFromP2} with ${lossCol1} > ${lossCol2}, but found ` +
        `${p1BetterRows.length} and ${p2BetterRows.length}.`
      );
    }

    const sampledP1Better = sampleWithoutReplacement(p1BetterRows, nFromP1, rng);
    const sampledP2Better = sampleWithoutReplacement(p2BetterRows, nFromP2, rng);

    // Combine and shuffle so the two types are mixed
    sampledRows = shuffleArray([...sampledP1Better, ...sampledP2Better], rng);
  }

  const sampledTrialIndices = sampledRows.map(row => {
    const idx = Number(row[trialIndexColumn]);
    if (!Number.isInteger(idx)) {
      throw new Error(
        `Row has invalid ${trialIndexColumn}: ${row[trialIndexColumn]}`
      );
    }
    if (!covidProblems[idx]) {
      throw new Error(`window.COVID_PROBLEMS[${idx}] is missing.`);
    }
    return idx;
  });

  const sampledProblemItems = sampledTrialIndices.map(idx => {
    const item = covidProblems[idx];
    return {
      trial_idx: idx,
      problem: item.problem,
      layout: JSON.parse(JSON.stringify(item.layout)),
      full_item: item
    };
  });

  return {
    cachedSolutions: [p1, p2],
    cachedSolutionColumns: [optCol1, `is_opt::${pathLengthTag} ${p2}`],
    lossColumns: [lossCol1, lossCol2],
    eligibleRows,
    sampledRows,
    sampledTrialIndices,
    sampledProblemItems
  };
}

    function pathArrayToArrowString(pathArr) {
  if (!Array.isArray(pathArr)) return null;
  return pathArr.join("→");
}

function normalizePathString(pathStr) {
  if (pathStr == null) return null;
  return String(pathStr).trim();
}

function getCachedPathMatchLabel(submittedPathString, cached1, cached2) {
  const s = normalizePathString(submittedPathString);
  const c1 = normalizePathString(cached1);
  const c2 = normalizePathString(cached2);

  if (s === c1) return 1;
  if (s === c2) return 2;
  return 0;
}

function toFiniteNumberOrNull(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function getLowerLossLabel(loss1, loss2) {
  if (loss1 == null || loss2 == null) return null;
  if (loss1 < loss2) return 1;
  if (loss2 < loss1) return 2;
  return 0; // tie
}

function convertPathToDisplayedCityNames(path, displayed_city_names){
  if(path===null | path===undefined){
    return null
  }
  for (const [oldCityName, newCityName] of Object.entries(displayed_city_names)) {
    path = path.replaceAll(
      "→"+oldCityName+"→",
      "→"+newCityName+"→"
    );
  }
  return path
}

function parseBaseDays(ruleText) {
  const m = String(ruleText).match(/Base:\s*(\d+)\s*days?/i);
  return m ? Number(m[1]) : 0;
}

function buildNodeMap(problem) {
  const map = {};
  for (const node of problem.nodes) {
    map[node.id] = node;
  }
  return map;
}

function buildEdgeMap(problem) {
  const map = new Map();
  for (const e of problem.edges) {
    map.set(`${e.u}|||${e.v}`, e);
    map.set(`${e.v}|||${e.u}`, e);
  }
  return map;
}

function normalizePath(path) {
  // Already an array like ['StartTown', 'I', 'G', 'GoalCity']
  if (Array.isArray(path)) {
    return path;
  }

  // Convert strings like:
  // "StartTown→I→G→GoalCity"
  // "StartTown->I->G->GoalCity"
  // "StartTown, I, G, GoalCity"
  // "StartTown | I | G | GoalCity"
  if (typeof path === "string") {
    let parts;

    if (path.includes("→")) {
      parts = path.split("→");
    } else if (path.includes("->")) {
      parts = path.split("->");
    } else if (path.includes(",")) {
      parts = path.split(",");
    } else if (path.includes("|")) {
      parts = path.split("|");
    } else {
      throw new Error(`Could not parse path string: ${path}`);
    }

    return parts.map(s => s.trim()).filter(Boolean);
  }

  throw new Error(`Path must be an array or string. Got: ${typeof path}`);
}

function makeExampleEquationStrings(problem, path, options = {}) {
  const {
    includeStartQuarantine = false,
    includeGoalQuarantine = false,
    dayValue = 100
  } = options;

  path = normalizePath(path);

  const nodeMap = buildNodeMap(problem);
  const edgeMap = buildEdgeMap(problem);

  const flightCosts = [];
  const flightDays = [];
  const edgeLabels = [];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const edge = edgeMap.get(`${a}|||${b}`);

    if (!edge) {
      throw new Error(
        `No edge found for segment ${a} -> ${b}. Full parsed path: ${JSON.stringify(path)}`
      );
    }

    flightCosts.push(edge.cost);
    flightDays.push(edge.duration);
    edgeLabels.push(`${a}→${b}`);
  }

  let qStartIdx = includeStartQuarantine ? 0 : 1;
  let qEndIdx = includeGoalQuarantine ? path.length - 1 : path.length - 2;

  const quarantineDays = [];
  const quarantineCityLabels = [];

  for (let i = qStartIdx; i <= qEndIdx; i++) {
    const city = path[i];
    const node = nodeMap[city];
    if (!node) {
      throw new Error(`No node found for city ${city}`);
    }
    const qd = parseBaseDays(node.rule_text);
    quarantineDays.push(qd);
    quarantineCityLabels.push(city);
  }

  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const joinEq = arr => arr.length ? arr.join(" + ") : "0";

  const totalFlightMoney = sum(flightCosts);
  const totalFlightDays = sum(flightDays);
  const totalQuarantineDays = sum(quarantineDays);
  const totalDays = totalFlightDays + totalQuarantineDays;
  const totalCost = totalFlightMoney + dayValue * totalDays;

  return {
    flightMoneyStr: `Flight money = ${joinEq(flightCosts)} = ${totalFlightMoney}`,
    flightDaysStr: `Flight days = ${joinEq(flightDays)} = ${totalFlightDays}`,
    quarantineDaysStr: `Quarantine days = ${joinEq(quarantineDays)} = ${totalQuarantineDays}`,
    totalDaysStr: `Total days = ${totalFlightDays} + ${totalQuarantineDays} = ${totalDays}`,
    totalCostStr: `Total cost = ${totalFlightMoney} + ${dayValue} × ${totalDays} = ${totalCost}`,

    flightCosts,
    flightDays,
    quarantineDays,
    edgeLabels,
    quarantineCityLabels,
    totalFlightMoney,
    totalFlightDays,
    totalQuarantineDays,
    totalDays,
    totalCost,
    path
  };
}






/*------------------
Helpers for making practice trials + logic
------------------*/



function getLatestPracticeMemoryOutcome(jsPsych, n_uncued_per_route) {
  const vals = jsPsych.data.get().filter({ phase: "practice" }).values();

  function getLatestTrialsForPrefix(prefix, nNeeded) {
    const matching = vals.filter(d =>
      typeof d.practice_attempt_tag === "string" &&
      d.practice_attempt_tag.startsWith(prefix)
    );
    return matching.slice(-nNeeded);
  }

  const aInitial = getLatestTrialsForPrefix("uncued_A_", n_uncued_per_route);
  const bInitial = getLatestTrialsForPrefix("uncued_B_", n_uncued_per_route);

  const aRelearn = getLatestTrialsForPrefix("relearn_uncued_A_", n_uncued_per_route);
  const bRelearn = getLatestTrialsForPrefix("relearn_uncued_B_", n_uncued_per_route);

  // Prefer relearn set if it exists; otherwise use initial set
  const aTrials = aRelearn.length > 0 ? aRelearn : aInitial;
  const bTrials = bRelearn.length > 0 ? bRelearn : bInitial;

  const aSuccess =
    aTrials.length === n_uncued_per_route &&
    aTrials.every(d => d.practice_memory_success === true);

  const bSuccess =
    bTrials.length === n_uncued_per_route &&
    bTrials.every(d => d.practice_memory_success === true);

  return {
    aTrials,
    bTrials,
    aSuccess,
    bSuccess
  };
}

function makePracticeReminderPage(routeNumber, displayedPath) {
  return {
    type: jsPsychInstructions,
    pages: [`
      <p style="font-size: 25px; font-weight: 500;">Reminder</p>
      <div style="text-align:left;">
        <p>
        Let's review <b>Familiar Route ${routeNumber}</b> once more:
        <br>${displayedPath}
        </p>
        <p>
        Please pay close attention. On the next trial, you will reproduce this route from memory.
        </p>
      </div>
    `],
    show_clickable_nav: true,
    button_label_next: "Continue",
    button_label_previous: "Back"
  };
}

function makePracticeRestartPage() {
  return {
    type: jsPsychInstructions,
    pages: [`
      <p style="font-size: 25px; font-weight: 500;">Let's practice those routes again</p>
      <div style="text-align:left;">
        <p>
        At least one familiar route was not reproduced correctly from memory yet.
        </p>
        <p>
        We will now repeat the short practice block once more.
        </p>
      </div>
    `],
    show_clickable_nav: true,
    allow_backward: false,
    button_label_next: "Continue"
  };
}



function makeRepeatedPracticeTrials({
  nTrials,
  attemptTagPrefix,
  targetPathString,
  routeNumber,
  isCued,
  startLocalTrialIndex,
  getPracticeItem,
  sampledSet,
  subject_mapping,
  subject_ring_order,
  CONFIG,
  rowByTrialIdx
}) {
  const out = [];
  for (let k = 0; k < nTrials; k++) {
    out.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(startLocalTrialIndex + k),
        localTrialIndex: startLocalTrialIndex + k,
        targetPathString,
        routeNumber,
        isCued,
        attemptTag: `${attemptTagPrefix}${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }
  return out;
}

function makeFamiliarRoutePracticeCycle({
  jsPsych,
  sampledSet,
  subject_mapping,
  subject_ring_order,
  CONFIG,
  rowByTrialIdx,
  n_cued_per_route = 2,
  n_uncued_per_route = 2,
  n_cued_relearn = 1
}) {
  const items = sampledSet.sampledProblemItems;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("sampledSet.sampledProblemItems is empty or missing.");
  }

  function getPracticeItem(idx) {
    return items[idx % items.length];
  }

  const routeA = sampledSet.cachedSolutions[0];
  const routeB = sampledSet.cachedSolutions[1];

  const routeADisplayed = convertPathToDisplayedCityNames(routeA, subject_mapping);
  const routeBDisplayed = convertPathToDisplayedCityNames(routeB, subject_mapping);

  let nextIdx = 0;
  let localTrialCounter = 0;

  const initialTimeline = [];

  // Interleaved cued block: A1, B1, A2, B2, ...
  for (let k = 0; k < n_cued_per_route; k++) {
    initialTimeline.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeA,
        routeNumber: 1,
        isCued: true,
        attemptTag: `cued_A_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );

    initialTimeline.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeB,
        routeNumber: 2,
        isCued: true,
        attemptTag: `cued_B_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }

  // Interleaved uncued block: A1, B1, A2, B2, ...
  for (let k = 0; k < n_uncued_per_route; k++) {
    initialTimeline.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeA,
        routeNumber: 1,
        isCued: false,
        attemptTag: `uncued_A_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );

    initialTimeline.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeB,
        routeNumber: 2,
        isCued: false,
        attemptTag: `uncued_B_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }

  const reminderA = makePracticeReminderPage(1, routeADisplayed);
  const reminderB = makePracticeReminderPage(2, routeBDisplayed);

  // Relearning timelines, also interleaved within route-specific relearning blocks
  const relearnTimelineA = [reminderA];

  for (let k = 0; k < n_cued_relearn; k++) {
    relearnTimelineA.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeA,
        routeNumber: 1,
        isCued: true,
        attemptTag: `relearn_cued_A_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }

  for (let k = 0; k < n_uncued_per_route; k++) {
    relearnTimelineA.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeA,
        routeNumber: 1,
        isCued: false,
        attemptTag: `relearn_uncued_A_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }

  const relearnTimelineB = [reminderB];

  for (let k = 0; k < n_cued_relearn; k++) {
    relearnTimelineB.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeB,
        routeNumber: 2,
        isCued: true,
        attemptTag: `relearn_cued_B_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }

  for (let k = 0; k < n_uncued_per_route; k++) {
    relearnTimelineB.push(
      makePracticeRouteTrial({
        sampledItem: getPracticeItem(nextIdx++),
        localTrialIndex: localTrialCounter++,
        targetPathString: routeB,
        routeNumber: 2,
        isCued: false,
        attemptTag: `relearn_uncued_B_${k + 1}`,
        sampledSet,
        subject_mapping,
        subject_ring_order,
        CONFIG,
        rowByTrialIdx
      })
    );
  }

  return {
    timeline: [
      ...initialTimeline,

      {
        timeline: relearnTimelineA,
        conditional_function: function() {
          const outcome = getLatestPracticeMemoryOutcome(jsPsych, n_uncued_per_route);
          return !outcome.aSuccess;
        }
      },

      {
        timeline: relearnTimelineB,
        conditional_function: function() {
          const outcome = getLatestPracticeMemoryOutcome(jsPsych, n_uncued_per_route);
          return !outcome.bSuccess;
        }
      }
    ]
  };
}


function makeFamiliarRoutePracticeBlock({
  jsPsych,
  sampledSet,
  subject_mapping,
  subject_ring_order,
  CONFIG,
  rowByTrialIdx,
  n_cued_per_route = 2,
  n_uncued_per_route = 2,
  n_cued_relearn = 1
}) {
  const cycleNode = makeFamiliarRoutePracticeCycle({
    jsPsych,
    sampledSet,
    subject_mapping,
    subject_ring_order,
    CONFIG,
    rowByTrialIdx,
    n_cued_per_route,
    n_uncued_per_route,
    n_cued_relearn
  });

  const restartPage = makePracticeRestartPage();

  return {
    timeline: [
      cycleNode,
      {
        timeline: [restartPage],
        conditional_function: function() {
          const outcome = getLatestPracticeMemoryOutcome(jsPsych, n_uncued_per_route);
          return !(outcome.aSuccess && outcome.bSuccess);
        }
      }
    ],
    loop_function: function() {
      const outcome = getLatestPracticeMemoryOutcome(jsPsych, n_uncued_per_route);
      return !(outcome.aSuccess && outcome.bSuccess);
    }
  };
}




// Counterbalanced sampling of trials, and separation into practice and test trial sets.

function splitSampledSet(sampledSet, nTrain, {
  balanceByPathComparison = true,
  pathLengthTag = "path[4]",
  seed = null,
  verbose = true
} = {}) {
  const rng = makeRNG(seed);

  if (!sampledSet || !Array.isArray(sampledSet.sampledRows)) {
    throw new Error("sampledSet.sampledRows must exist and be an array.");
  }

  const rows = sampledSet.sampledRows;
  const total = rows.length;

  if (!Number.isInteger(nTrain) || nTrain < 0 || nTrain > total) {
    throw new Error(`nTrain must be an integer between 0 and ${total}.`);
  }

  const allIndices = [...Array(total).keys()];

  // Original behavior: order-based split
  function originalSplit() {
    return {
      trainIndices: allIndices.slice(0, nTrain),
      testIndices: allIndices.slice(nTrain)
    };
  }

  function pickByIndices(arr, indices) {
    if (!Array.isArray(arr)) {
      throw new Error("Expected sampled fields to be arrays.");
    }
    return indices.map(i => arr[i]);
  }

  function warn(msg) {
    if (verbose) {
      console.warn(msg);
    }
  }

  let trainIndices, testIndices;

  if (!balanceByPathComparison) {
    ({ trainIndices, testIndices } = originalSplit());
  } else {
    if (
      !Array.isArray(sampledSet.cachedSolutions) ||
      sampledSet.cachedSolutions.length < 2
    ) {
      warn("splitSampledSet: cachedSolutions missing; falling back to unbalanced split.");
      ({ trainIndices, testIndices } = originalSplit());
    } else {
      const [p1, p2] = sampledSet.cachedSolutions;
      const lossCol1 = `loss::${pathLengthTag} ${p1}`;
      const lossCol2 = `loss::${pathLengthTag} ${p2}`;

      const p1BetterIdx = [];
      const p2BetterIdx = [];
      const unknownIdx = [];

      rows.forEach((row, idx) => {
        const loss1 = Number(row[lossCol1]);
        const loss2 = Number(row[lossCol2]);

        if (!Number.isFinite(loss1) || !Number.isFinite(loss2)) {
          unknownIdx.push(idx);
          return;
        }

        if (loss1 < loss2) {
          p1BetterIdx.push(idx);
        } else if (loss1 > loss2) {
          p2BetterIdx.push(idx);
        } else {
          unknownIdx.push(idx); // ties treated as unknown/flexible
        }
      });

      // If nothing can be classified, fall back gracefully
      if (p1BetterIdx.length === 0 && p2BetterIdx.length === 0) {
        warn(
          `splitSampledSet: could not classify rows using columns "${lossCol1}" and "${lossCol2}". ` +
          `Falling back to unbalanced split.`
        );
        ({ trainIndices, testIndices } = originalSplit());
      } else {
        // Randomize within each bucket
        const p1Pool = shuffleArray(p1BetterIdx, rng);
        const p2Pool = shuffleArray(p2BetterIdx, rng);
        const unknownPool = shuffleArray(unknownIdx, rng);

        const nTest = total - nTrain;

        // Soft target counts
        let targetTrainP1 = Math.floor(nTrain / 2);
        let targetTrainP2 = Math.floor(nTrain / 2);
        if (nTrain % 2 === 1) {
          if (rng() < 0.5) targetTrainP1 += 1;
          else targetTrainP2 += 1;
        }

        // Take as close as possible to target from each side
        const trainP1 = p1Pool.slice(0, Math.min(targetTrainP1, p1Pool.length));
        const trainP2 = p2Pool.slice(0, Math.min(targetTrainP2, p2Pool.length));

        let usedP1 = trainP1.length;
        let usedP2 = trainP2.length;

        let currentTrain = [...trainP1, ...trainP2];

        // Fill remaining train slots from leftovers + unknowns
        const leftoverPool = shuffleArray([
          ...p1Pool.slice(usedP1),
          ...p2Pool.slice(usedP2),
          ...unknownPool
        ], rng);

        const remainingNeeded = nTrain - currentTrain.length;
        currentTrain = currentTrain.concat(leftoverPool.slice(0, remainingNeeded));

        // Everything not in train goes to test
        const trainSet = new Set(currentTrain);
        let currentTest = allIndices.filter(i => !trainSet.has(i));

        // Shuffle final order within split
        trainIndices = shuffleArray(currentTrain, rng);
        testIndices = shuffleArray(currentTest, rng);

        // Optional warning when exact balance could not be achieved
        const countType = (indices) => {
          let c1 = 0, c2 = 0, cu = 0;
          for (const i of indices) {
            if (p1BetterIdx.includes(i)) c1++;
            else if (p2BetterIdx.includes(i)) c2++;
            else cu++;
          }
          return { p1Better: c1, p2Better: c2, unknown: cu };
        };

        const trainCounts = countType(trainIndices);
        const testCounts = countType(testIndices);

        const trainImbalance = Math.abs(trainCounts.p1Better - trainCounts.p2Better);
        const testImbalance = Math.abs(testCounts.p1Better - testCounts.p2Better);

        if (verbose && (trainImbalance > 1 || testImbalance > 1 || unknownIdx.length > 0)) {
          warn(
            `splitSampledSet: soft-balanced split used. ` +
            `Train counts=${JSON.stringify(trainCounts)}, ` +
            `Test counts=${JSON.stringify(testCounts)}.`
          );
        }
      }
    }
  }

  const train = {};
  const test = {};

  for (const [key, value] of Object.entries(sampledSet)) {
    if (key.includes("sampled")) {
      train[key] = pickByIndices(value, trainIndices);
      test[key] = pickByIndices(value, testIndices);
    } else {
      train[key] = value;
      test[key] = value;
    }
  }

  return { train, test };
}


// Recall probes
function canonicalUndirectedEdgeKey(a, b) {
  return [a, b].sort().join("||");
}

function parsePathStringToNodes(pathStr) {
  if (!pathStr) return [];
  return String(pathStr).split("→").map(s => s.trim()).filter(Boolean);
}

function edgesFromPathString(pathStr) {
  const nodes = parsePathStringToNodes(pathStr);
  const out = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    out.push([nodes[i], nodes[i + 1]]);
  }
  return out;
}

function getAllNodeIds(problem) {
  return (problem.nodes || []).map(n => n.id);
}

function edgeExistsInProblem(problem, a, b) {
  const target = canonicalUndirectedEdgeKey(a, b);
  return (problem.edges || []).some(e => canonicalUndirectedEdgeKey(e.u, e.v) === target);
}

function sampleWithoutReplacementSafe(arr, n) {
  if (!Array.isArray(arr) || arr.length === 0 || n <= 0) return [];
  const k = Math.min(n, arr.length);
  return jsPsych.randomization.sampleWithoutReplacement(arr, k);
}

function getIntermediateNodesOfPath(pathStr) {
  const nodes = parsePathStringToNodes(pathStr);
  if (nodes.length <= 2) return [];
  return nodes.slice(1, -1);
}


function buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB) {
  const aEdges = edgesFromPathString(cachedSolutionA);
  const bEdges = edgesFromPathString(cachedSolutionB);

  const aKeys = new Set(aEdges.map(([u, v]) => canonicalUndirectedEdgeKey(u, v)));
  const bKeys = new Set(bEdges.map(([u, v]) => canonicalUndirectedEdgeKey(u, v)));
  const sharedKeys = new Set([...aKeys].filter(k => bKeys.has(k)));

  const cachedA = aEdges.map(([u, v]) => ({
    nodePair: [u, v],
    truth: true,
    probe_family: "cached",
    cached_route_label: 1,
    is_shared_cached_edge: sharedKeys.has(canonicalUndirectedEdgeKey(u, v)),
  }));

  const cachedB = bEdges.map(([u, v]) => ({
    nodePair: [u, v],
    truth: true,
    probe_family: "cached",
    cached_route_label: 2,
    is_shared_cached_edge: sharedKeys.has(canonicalUndirectedEdgeKey(u, v)),
  }));

  return { cachedA, cachedB };
}

function sampleCachedEdgeProbes(problem, cachedSolutionA, cachedSolutionB, rng, nA = 2, nB = 2) {
  const { cachedA, cachedB } = buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB);

  function pickRouteEdges(pool, nWanted) {
    const nonshared = pool.filter(p => !p.is_shared_cached_edge);
    const shared = pool.filter(p => p.is_shared_cached_edge);

    const picked = [];
    picked.push(...sampleWithoutReplacementWithRng(nonshared, nWanted, rng));

    if (picked.length < nWanted) {
      const used = new Set(picked.map(p => canonicalUndirectedEdgeKey(...p.nodePair)));
      const remainingShared = shared.filter(p => !used.has(canonicalUndirectedEdgeKey(...p.nodePair)));
      picked.push(...sampleWithoutReplacementWithRng(remainingShared, nWanted - picked.length, rng));
    }
    return picked;
  }

  return [
    ...pickRouteEdges(cachedA, nA),
    ...pickRouteEdges(cachedB, nB),
  ];
}

function buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB) {
  const aEdges = edgesFromPathString(cachedSolutionA);
  const bEdges = edgesFromPathString(cachedSolutionB);

  const aKeys = new Set(aEdges.map(([u, v]) => canonicalUndirectedEdgeKey(u, v)));
  const bKeys = new Set(bEdges.map(([u, v]) => canonicalUndirectedEdgeKey(u, v)));
  const sharedKeys = new Set([...aKeys].filter(k => bKeys.has(k)));

  const cachedA = aEdges.map(([u, v]) => ({
    nodePair: [u, v],
    truth: true,
    probe_family: "cached",
    cached_route_label: 1,
    is_shared_cached_edge: sharedKeys.has(canonicalUndirectedEdgeKey(u, v)),
  }));

  const cachedB = bEdges.map(([u, v]) => ({
    nodePair: [u, v],
    truth: true,
    probe_family: "cached",
    cached_route_label: 2,
    is_shared_cached_edge: sharedKeys.has(canonicalUndirectedEdgeKey(u, v)),
  }));

  return { cachedA, cachedB };
}

function buildBranchProbePools(problem, cachedSolutionA, cachedSolutionB) {
  const nodesA = parsePathStringToNodes(cachedSolutionA);
  const nodesB = parsePathStringToNodes(cachedSolutionB);

  const startNode = nodesA[0];
  const goalNode = nodesA[nodesA.length - 1];

  const parentNodes = [...new Set([
    startNode,
    ...getIntermediateNodesOfPath(cachedSolutionA),
    ...getIntermediateNodesOfPath(cachedSolutionB),
  ])];

  const cachedEdgeSet = new Set([
    ...edgesFromPathString(cachedSolutionA).map(([u, v]) => canonicalUndirectedEdgeKey(u, v)),
    ...edgesFromPathString(cachedSolutionB).map(([u, v]) => canonicalUndirectedEdgeKey(u, v)),
  ]);

  const allNodeIds = getAllNodeIds(problem);

  const posMap = new Map();
  const negMap = new Map();

  for (const parent of parentNodes) {
    for (const other of allNodeIds) {
      if (other === parent) continue;
      if (other === goalNode) continue; // exclude parent->Goal from branch probes

      const k = canonicalUndirectedEdgeKey(parent, other);
      if (cachedEdgeSet.has(k)) continue;

      const payload = {
        nodePair: [parent, other],
        truth: edgeExistsInProblem(problem, parent, other),
        probe_family: "branch",
        branch_parent_node: parent,
      };

      if (payload.truth) {
        if (!posMap.has(k)) posMap.set(k, payload);
      } else {
        if (!negMap.has(k)) negMap.set(k, payload);
      }
    }
  }

  return {
    pos: [...posMap.values()],
    neg: [...negMap.values()],
  };
}

function buildIrrelevantProbePools(problem, cachedSolutionA, cachedSolutionB) {
  const cachedNodeSet = new Set([
    ...parsePathStringToNodes(cachedSolutionA),
    ...parsePathStringToNodes(cachedSolutionB),
  ]);

  const offCachedNodes = getAllNodeIds(problem).filter(n => !cachedNodeSet.has(n));

  const posMap = new Map();
  const negMap = new Map();

  for (let i = 0; i < offCachedNodes.length; i++) {
    for (let j = i + 1; j < offCachedNodes.length; j++) {
      const a = offCachedNodes[i];
      const b = offCachedNodes[j];
      const k = canonicalUndirectedEdgeKey(a, b);

      const payload = {
        nodePair: [a, b],
        truth: edgeExistsInProblem(problem, a, b),
        probe_family: "irrelevant",
      };

      if (payload.truth) {
        if (!posMap.has(k)) posMap.set(k, payload);
      } else {
        if (!negMap.has(k)) negMap.set(k, payload);
      }
    }
  }

  return {
    pos: [...posMap.values()],
    neg: [...negMap.values()],
  };
}



function sampleCachedEdgeProbes(problem, cachedSolutionA, cachedSolutionB, rng, nA = 2, nB = 2) {
  const { cachedA, cachedB } = buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB);

  function pickRouteEdges(pool, nWanted) {
    const nonshared = pool.filter(p => !p.is_shared_cached_edge);
    const shared = pool.filter(p => p.is_shared_cached_edge);

    const picked = [];
    picked.push(...sampleWithoutReplacementWithRng(nonshared, nWanted, rng));

    if (picked.length < nWanted) {
      const used = new Set(picked.map(p => canonicalUndirectedEdgeKey(...p.nodePair)));
      const remainingShared = shared.filter(p => !used.has(canonicalUndirectedEdgeKey(...p.nodePair)));
      picked.push(...sampleWithoutReplacementWithRng(remainingShared, nWanted - picked.length, rng));
    }
    return picked;
  }

  return [
    ...pickRouteEdges(cachedA, nA),
    ...pickRouteEdges(cachedB, nB),
  ];
}

function sampleBranchProbes(problem, cachedSolutionA, cachedSolutionB, recallProbePlan) {
  const pools = buildBranchProbePools(problem, cachedSolutionA, cachedSolutionB);

  return {
    branch_pos_selected: sampleWithoutReplacementSafe(pools.pos, recallProbePlan.branch_pos_n),
    branch_neg_selected: sampleWithoutReplacementSafe(pools.neg, recallProbePlan.branch_neg_n),
  };
}

function sampleIrrelevantProbes(problem, cachedSolutionA, cachedSolutionB, recallProbePlan) {
  const pools = buildIrrelevantProbePools(problem, cachedSolutionA, cachedSolutionB);

  return {
    irrelevant_pos_selected: sampleWithoutReplacementSafe(pools.pos, recallProbePlan.irrelevant_pos_n),
    irrelevant_neg_selected: sampleWithoutReplacementSafe(pools.neg, recallProbePlan.irrelevant_neg_n),
  };
}


function canonicalUndirectedEdgeKey(a, b) {
  return [a, b].sort().join("||");
}

function parsePathStringToNodes(pathStr) {
  if (!pathStr) return [];
  return String(pathStr).split("→").map(s => s.trim()).filter(Boolean);
}

function edgesFromPathString(pathStr) {
  const nodes = parsePathStringToNodes(pathStr);
  const out = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    out.push([nodes[i], nodes[i + 1]]);
  }
  return out;
}

function getAllNodeIds(problem) {
  return (problem.nodes || []).map(n => n.id);
}

function edgeExistsInProblem(problem, a, b) {
  const k = canonicalUndirectedEdgeKey(a, b);
  return (problem.edges || []).some(e => canonicalUndirectedEdgeKey(e.u, e.v) === k);
}

function getIntermediateNodesOfPath(pathStr) {
  const nodes = parsePathStringToNodes(pathStr);
  if (nodes.length <= 2) return [];
  return nodes.slice(1, -1);
}


function sampleCachedRouteProbes(problem, cachedSolutionA, cachedSolutionB, rng, nA = 2, nB = 2) {
  const { cachedA, cachedB } = buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB);

  function pickRouteEdges(pool, nWanted) {
    const nonshared = pool.filter(p => !p.is_shared_cached_edge);
    const shared = pool.filter(p => p.is_shared_cached_edge);

    const picked = [];
    picked.push(...sampleWithoutReplacementWithRng(nonshared, nWanted, rng));

    if (picked.length < nWanted) {
      const used = new Set(picked.map(p => canonicalUndirectedEdgeKey(...p.nodePair)));
      const remainingShared = shared.filter(p => !used.has(canonicalUndirectedEdgeKey(...p.nodePair)));
      picked.push(...sampleWithoutReplacementWithRng(remainingShared, nWanted - picked.length, rng));
    }

    return picked;
  }

  return [
    ...pickRouteEdges(cachedA, nA),
    ...pickRouteEdges(cachedB, nB),
  ];
}


function classifyRecallProbeRelativeToChoice(probe, cachedChosenLabel) {
  const out = { ...probe };

  if (probe.probe_family === "cached") {
    if (cachedChosenLabel === 1 || cachedChosenLabel === 2) {
      out.analysis_probe_class =
        probe.cached_route_label === cachedChosenLabel
          ? "selected_cached"
          : "unselected_cached";
    } else {
      out.analysis_probe_class = "cached_probe_when_noncached_choice";
    }
  } else if (probe.probe_family === "branch") {
    out.analysis_probe_class = "branch";
  } else if (probe.probe_family === "irrelevant") {
    out.analysis_probe_class = "irrelevant";
  } else {
    out.analysis_probe_class = "unknown";
  }

  return out;
}




function debugRecallPoolSizes(problem, cachedSolutionA, cachedSolutionB) {
  const cachedPools = buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB);
  const branchPools = buildBranchProbePools(problem, cachedSolutionA, cachedSolutionB);
  const irrelevantPools = buildIrrelevantProbePools(problem, cachedSolutionA, cachedSolutionB);

  console.log("cached A edges:", cachedPools.cachedA.length);
  console.log("cached B edges:", cachedPools.cachedB.length);
  console.log("branch pos:", branchPools.pos.length, "branch neg:", branchPools.neg.length);
  console.log("irrelevant pos:", irrelevantPools.pos.length, "irrelevant neg:", irrelevantPools.neg.length);
}









/* =========================================================
Recall-probe helpers
========================================================= */

function canonicalUndirectedEdgeKey(a, b) {
  return [a, b].sort().join("||");
}

function getAllNodeIds(problem) {
  return (problem.nodes || []).map(n => n.id);
}

function edgeExistsInProblem(problem, a, b) {
  const k = canonicalUndirectedEdgeKey(a, b);
  return (problem.edges || []).some(
    e => canonicalUndirectedEdgeKey(e.u, e.v) === k
  );
}

function getIntermediateNodesOfPath(pathStr) {
  const nodes = parsePathStringToNodes(pathStr);
  if (nodes.length <= 2) return [];
  return nodes.slice(1, -1);
}

/* ---------- Cached-edge pools ----------
   Exactly the real edges on cached A / B.
   Prefer non-shared edges when sampling.
*/
function buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB) {
  const aEdges = edgesFromPathString(cachedSolutionA);
  const bEdges = edgesFromPathString(cachedSolutionB);

  const aKeys = new Set(aEdges.map(([u, v]) => canonicalUndirectedEdgeKey(u, v)));
  const bKeys = new Set(bEdges.map(([u, v]) => canonicalUndirectedEdgeKey(u, v)));
  const sharedKeys = new Set([...aKeys].filter(k => bKeys.has(k)));

  const cachedA = aEdges.map(([u, v]) => ({
    nodePair: [u, v],
    truth: true,
    probe_family: "cached",
    cached_route_label: 1,
    is_shared_cached_edge: sharedKeys.has(canonicalUndirectedEdgeKey(u, v)),
  }));

  const cachedB = bEdges.map(([u, v]) => ({
    nodePair: [u, v],
    truth: true,
    probe_family: "cached",
    cached_route_label: 2,
    is_shared_cached_edge: sharedKeys.has(canonicalUndirectedEdgeKey(u, v)),
  }));

  return { cachedA, cachedB };
}

function sampleCachedEdgeProbes(problem, cachedSolutionA, cachedSolutionB, rng, nA = 2, nB = 2) {
  const { cachedA, cachedB } = buildCachedEdgePools(problem, cachedSolutionA, cachedSolutionB);

  function pickRouteEdges(pool, nWanted) {
    const nonshared = pool.filter(p => !p.is_shared_cached_edge);
    const shared = pool.filter(p => p.is_shared_cached_edge);

    const picked = [];
    picked.push(...sampleWithoutReplacement(nonshared, Math.min(nWanted, nonshared.length), rng));

    if (picked.length < nWanted) {
      const used = new Set(picked.map(p => canonicalUndirectedEdgeKey(...p.nodePair)));
      const remainingShared = shared.filter(
        p => !used.has(canonicalUndirectedEdgeKey(...p.nodePair))
      );
      picked.push(
        ...sampleWithoutReplacement(
          remainingShared,
          Math.min(nWanted - picked.length, remainingShared.length),
          rng
        )
      );
    }

    return picked;
  }
  //   console.log([
  //  ...pickRouteEdges(cachedA, nA),
  //   ...pickRouteEdges(cachedB, nB),
  // ])

  return [
    ...pickRouteEdges(cachedA, nA),
    ...pickRouteEdges(cachedB, nB),
  ];
}

/* ---------- Branch-off pools ----------
   Parent nodes = Start + intermediate nodes on either cached route.
   Goal is NOT a parent.
   Exclude cached-route edges themselves.
   Exclude parent->Goal.
   Branch-off edges (whether positive or negative probes) are defined as: there is and is only one node among the two that is on a cached path.
*/
function buildBranchProbePools(problem, cachedSolutionA, cachedSolutionB) {
  const nodesA = parsePathStringToNodes(cachedSolutionA);
  const nodesB = parsePathStringToNodes(cachedSolutionB);

  const startNode = nodesA[0];
  const goalNode = nodesA[nodesA.length - 1];

  // Nodes lying anywhere on either cached path
  const cachedNodeSet = new Set([...nodesA, ...nodesB]);

  // Candidate "parent" nodes along cached paths from which branch-offs can emanate.
  // Keep your old logic: start + intermediate nodes, but not goal.
  const parentNodes = [...new Set([
    // startNode,
    ...getIntermediateNodesOfPath(cachedSolutionA),
    ...getIntermediateNodesOfPath(cachedSolutionB),
  ])];

  const cachedEdgeSet = new Set([
    ...edgesFromPathString(cachedSolutionA).map(([u, v]) => canonicalUndirectedEdgeKey(u, v)),
    ...edgesFromPathString(cachedSolutionB).map(([u, v]) => canonicalUndirectedEdgeKey(u, v)),
  ]);

  const allNodeIds = getAllNodeIds(problem);

  // Nodes not on either cached path
  const outsideNodes = allNodeIds.filter(n => !cachedNodeSet.has(n));

  const posMap = new Map();
  const negMap = new Map();

  for (const parent of parentNodes) {
    for (const other of outsideNodes) {
      if (other === parent) continue;
      if (other === goalNode) continue; // usually redundant now, but keep for safety

      const k = canonicalUndirectedEdgeKey(parent, other);
      if (cachedEdgeSet.has(k)) continue;

      const payload = {
        nodePair: [parent, other],
        truth: edgeExistsInProblem(problem, parent, other),
        probe_family: "branch",
        branch_parent_node: parent,
      };

      if (payload.truth) {
        if (!posMap.has(k)) posMap.set(k, payload);
      } else {
        if (!negMap.has(k)) negMap.set(k, payload);
      }
    }
  }

  return {
    pos: [...posMap.values()],
    neg: [...negMap.values()],
  };
}

/* ---------- Irrelevant pools ----------
   Neither endpoint lies on either cached route.
*/
function buildIrrelevantProbePools(problem, cachedSolutionA, cachedSolutionB) {
  const cachedNodeSet = new Set([
    ...parsePathStringToNodes(cachedSolutionA),
    ...parsePathStringToNodes(cachedSolutionB),
  ]);

  const offCachedNodes = getAllNodeIds(problem).filter(n => !cachedNodeSet.has(n));

  const posMap = new Map();
  const negMap = new Map();

  for (let i = 0; i < offCachedNodes.length; i++) {
    for (let j = i + 1; j < offCachedNodes.length; j++) {
      const a = offCachedNodes[i];
      const b = offCachedNodes[j];
      const k = canonicalUndirectedEdgeKey(a, b);

      const payload = {
        nodePair: [a, b],
        truth: edgeExistsInProblem(problem, a, b),
        probe_family: "irrelevant",
      };

      if (payload.truth) {
        if (!posMap.has(k)) posMap.set(k, payload);
      } else {
        if (!negMap.has(k)) negMap.set(k, payload);
      }
    }
  }
  // console.log({
  //   pos: [...posMap.values()],
  //   neg: [...negMap.values()],
  // })

  return {
    pos: [...posMap.values()],
    neg: [...negMap.values()],
  };
}

/* ---------- Build the subject-specific 12-probe schedule ----------
   Default 4 / 5 / 3 plan:
   - cached A: 2
   - cached B: 2
   - branch pos: 2
   - branch neg: 3
   - irrelevant pos: 0
   - irrelevant neg: 3
*/
function buildRecallProbeScheduleOld({
  testSet,
  sampledSet,
  rng,
  recallProbePlan = {
    cachedA_n: 2,
    cachedB_n: 2,
    branch_pos_n: 2,
    branch_neg_n: 3,
    irrelevant_pos_n: 0,
    irrelevant_neg_n: 3,
  }
}) {
  const cachedSolutionA = sampledSet.cachedSolutions[0];
  const cachedSolutionB = sampledSet.cachedSolutions[1];

  if (!testSet.sampledProblemItems || testSet.sampledProblemItems.length === 0) {
    throw new Error("buildRecallProbeSchedule: testSet.sampledProblemItems is empty.");
  }

  // Assumes graph topology is shared across test trials.
  const baseProblem = JSON.parse(JSON.stringify(testSet.sampledProblemItems[0].problem));

  const cachedProbes = sampleCachedEdgeProbes(
    baseProblem,
    cachedSolutionA,
    cachedSolutionB,
    rng,
    recallProbePlan.cachedA_n,
    recallProbePlan.cachedB_n
  );

  const branchPools = buildBranchProbePools(baseProblem, cachedSolutionA, cachedSolutionB);
  const branchPos = sampleWithoutReplacement(
    branchPools.pos,
    Math.min(recallProbePlan.branch_pos_n, branchPools.pos.length),
    rng
  );
  const branchNeg = sampleWithoutReplacement(
    branchPools.neg,
    Math.min(recallProbePlan.branch_neg_n, branchPools.neg.length),
    rng
  );

  const irrelevantPools = buildIrrelevantProbePools(baseProblem, cachedSolutionA, cachedSolutionB);
  const irrelevantPos = sampleWithoutReplacement(
    irrelevantPools.pos,
    Math.min(recallProbePlan.irrelevant_pos_n, irrelevantPools.pos.length),
    rng
  );
  const irrelevantNeg = sampleWithoutReplacement(
    irrelevantPools.neg,
    Math.min(recallProbePlan.irrelevant_neg_n, irrelevantPools.neg.length),
    rng
  );

  const probeList = [
    ...cachedProbes,
    ...branchPos,
    ...branchNeg,
    ...irrelevantPos,
    ...irrelevantNeg,
  ].map((p, idx) => ({
    ...p,
    schedule_index_unshuffled: idx,
  }));

  const expectedN =
    recallProbePlan.cachedA_n +
    recallProbePlan.cachedB_n +
    recallProbePlan.branch_pos_n +
    recallProbePlan.branch_neg_n +
    recallProbePlan.irrelevant_pos_n +
    recallProbePlan.irrelevant_neg_n;

  if (probeList.length !== expectedN) {
    throw new Error(
      `buildRecallProbeSchedule: expected ${expectedN} recall probes, got ${probeList.length}. ` +
      `Likely one of the probe pools is too small for this graph.`
    );
  }

  const shuffled = shuffleArray(probeList, rng).map((p, idx) => ({
    ...p,
    schedule_index_shuffled: idx,
  }));

  return {
    probeList: shuffled,
    nextIndex: 0,
    plan: { ...recallProbePlan }
  };
}

/* ---------- Build the subject-specific recall-probe schedule (Method B) ----------
   Design:
   - cached A: 3 positive
   - cached B: 3 positive
   - branch pos: u
   - branch neg: u
   - irrelevant pos: u
   - irrelevant neg: u

   where u = min(
     # available branch positive,
     # available branch negative,
     # available irrelevant positive,
     # available irrelevant negative
   )

   Total positives   = 6 + 2u
   Total negatives   = 2u

   Probes are then shuffled and distributed as evenly as possible across
   the N test trials, with the remainder assigned randomly to some trials.
*/
function buildRecallProbeSchedule({
  testSet,
  sampledSet,
  rng,
  cachedA_n = 3,
  cachedB_n = 3,
}) {
  const cachedSolutionA = sampledSet.cachedSolutions[0];
  const cachedSolutionB = sampledSet.cachedSolutions[1];

  if (!testSet.sampledProblemItems || testSet.sampledProblemItems.length === 0) {
    throw new Error("buildRecallProbeSchedule: testSet.sampledProblemItems is empty.");
  }

  const nTestTrials = testSet.sampledProblemItems.length;
  const baseProblem = JSON.parse(JSON.stringify(testSet.sampledProblemItems[0].problem));

  const branchPools = buildBranchProbePools(baseProblem, cachedSolutionA, cachedSolutionB);
  const irrelevantPools = buildIrrelevantProbePools(baseProblem, cachedSolutionA, cachedSolutionB);

  const w = branchPools.pos.length;
  const x = branchPools.neg.length;
  const y = irrelevantPools.pos.length;
  const z = irrelevantPools.neg.length;

  // Can't have more than 2 recall probes after each test trial. The value of u must be capped.
  const u = Math.min(Math.min(w, x, y, z), Math.floor((2*testSet.sampledProblemItems.length-cachedA_n-cachedB_n)/4));

  // --- Sample cached A and B separately, then tag them ourselves ---
  const cachedAProbesRaw = sampleCachedEdgeProbes(
    baseProblem,
    cachedSolutionA,
    null,
    rng,
    cachedA_n,
    0
  );

  const cachedBProbesRaw = sampleCachedEdgeProbes(
    baseProblem,
    null,
    cachedSolutionB,
    rng,
    0,
    cachedB_n
  );

  if (cachedAProbesRaw.length !== cachedA_n) {
    throw new Error(
      `buildRecallProbeSchedule: expected ${cachedA_n} cached A probes, got ${cachedAProbesRaw.length}.`
    );
  }

  if (cachedBProbesRaw.length !== cachedB_n) {
    throw new Error(
      `buildRecallProbeSchedule: expected ${cachedB_n} cached B probes, got ${cachedBProbesRaw.length}.`
    );
  }

  const cachedAProbes = cachedAProbesRaw.map(p => ({
    ...p,
    probe_type: "cachedA",
    probe_family: "cached",
    ground_truth_answer: "yes",
  }));

  const cachedBProbes = cachedBProbesRaw.map(p => ({
    ...p,
    probe_type: "cachedB",
    probe_family: "cached",
    ground_truth_answer: "yes",
  }));

  const branchPos = sampleWithoutReplacement(branchPools.pos, u, rng).map(p => ({
    ...p,
    probe_family: "branch",
  }));

  const branchNeg = sampleWithoutReplacement(branchPools.neg, u, rng).map(p => ({
    ...p,
    probe_family: "branch",
  }));

  const irrelevantPos = sampleWithoutReplacement(irrelevantPools.pos, u, rng).map(p => ({
    ...p,
    probe_family: "irrelevant",
  }));

  const irrelevantNeg = sampleWithoutReplacement(irrelevantPools.neg, u, rng).map(p => ({
    ...p,
    probe_family: "irrelevant",
  }));

  const probeListUnshuffled = [
    ...cachedAProbes,
    ...cachedBProbes,
    ...branchPos,
    ...branchNeg,
    ...irrelevantPos,
    ...irrelevantNeg,
  ].map((p, idx) => ({
    ...p,
    schedule_index_unshuffled: idx,
  }));

  const probeList = shuffleArray(probeListUnshuffled, rng).map((p, idx) => ({
    ...p,
    schedule_index_shuffled: idx,
  }));

  const totalProbes = probeList.length;
  const basePerTrial = Math.floor(totalProbes / nTestTrials);
  const remainder = totalProbes % nTestTrials;

  const probesPerTrial = Array(nTestTrials).fill(basePerTrial);
  const trialIndices = [...Array(nTestTrials).keys()];
  const extraProbeTrials = sampleWithoutReplacement(trialIndices, remainder, rng);

  extraProbeTrials.forEach(ti => {
    probesPerTrial[ti] += 1;
  });

  return {
    probeList,
    nextIndex: 0,
    probesPerTrial,
    designSummary: {
      cachedA_n,
      cachedB_n,
      branch_pos_n: u,
      branch_neg_n: u,
      irrelevant_pos_n: u,
      irrelevant_neg_n: u,
      total_positive: cachedA_n + cachedB_n + u + u,
      total_negative: u + u,
      total_probes: totalProbes,
      n_test_trials: nTestTrials,
      basePerTrial,
      remainder,
      poolSizes: { w, x, y, z }
    }
  };
}

/* ---------- Reclassify cached probes relative to actual subject choice ---------- */
function classifyRecallProbeRelativeToChoice(probe, cachedChosenLabel) {
  const out = { ...probe };

  if (probe.probe_family === "cached") {
    if (cachedChosenLabel === 1 || cachedChosenLabel === 2) {
      out.analysis_probe_class =
        probe.cached_route_label === cachedChosenLabel
          ? "selected_cached"
          : "unselected_cached";
    } else {
      out.analysis_probe_class = "cached_probe_when_noncached_choice";
    }
  } else if (probe.probe_family === "branch") {
    out.analysis_probe_class = "branch";
  } else if (probe.probe_family === "irrelevant") {
    out.analysis_probe_class = "irrelevant";
  } else {
    out.analysis_probe_class = "unknown";
  }

  return out;
}

/* ---------- Dynamic recall trial wrapper ---------- */
function makeRecallProbeTrial({
  sampledItem,
  layout,
  subject_mapping,
  sampledSet,
  CONFIG,
  recallQuotaRemaining,
  usedRecallProbeEdgeKeys
}) {
  if (!recallQuotaRemaining || !Array.isArray(recallQuotaRemaining.probeList)) {
    throw new Error("makeRecallProbeTrial: recallQuotaRemaining must contain a presampled probeList.");
  }
  if (recallQuotaRemaining.nextIndex >= recallQuotaRemaining.probeList.length) {
    throw new Error("makeRecallProbeTrial: no recall probes remaining in schedule.");
  }

  return {
    timeline: [{
      type: jsPsychItineraryGraph,
      trial_mode: "recall_probe",

      radius: 300,
      center_x: CONFIG.canvas_size / 2,
      center_y: CONFIG.canvas_size / 2,
      width: CONFIG.canvas_size,
      height: CONFIG.canvas_size,

      problem: null,
      ring_order: null,
      displayed_city_names: subject_mapping,

      show_right_panel: true,
      interactive_graph: false,
      show_clear_button: false,
      require_continue_button: false,

      enable_select_edges: false,
      enable_reveal_labels: false,
      enable_hover_reveal: false,
      enable_highlight: false,
      enable_drag_labels: false,

      labels_visible_by_default: false,
      highlight_best_path: false,
      include_cityname: true,
      include_virus: false,
      include_q_cost: false,

      recall_probe_nodes: null,
      recall_probe_question_html: "<b>Was there a direct flight between these two cities?</b>",
      recall_probe_show_candidate_edge: false,

      time_limit_sec: null,
      force_end_on_timeout: true,

      data: {
        phase: "recall_probe"
      },

      on_start: function(trial) {
        const lastTask = jsPsych.data.get().filter({ trial_mode: "task" }).last(1).values()[0];
        if (!lastTask) {
          throw new Error("Recall probe could not find previous task trial.");
        }

        if (recallQuotaRemaining.nextIndex >= recallQuotaRemaining.probeList.length) {
          throw new Error("Recall probe schedule exhausted.");
        }

        const probe = recallQuotaRemaining.probeList[recallQuotaRemaining.nextIndex];
        recallQuotaRemaining.nextIndex += 1;

        const problem = JSON.parse(JSON.stringify(sampledItem.problem));
        const ring_order = layout.ring_order.slice();

        const classifiedProbe = classifyRecallProbeRelativeToChoice(
          probe,
          lastTask.cached_solution_chosen_label ?? null
        );

        trial.problem = problem;
        trial.ring_order = ring_order;
        trial.recall_probe_nodes = classifiedProbe.nodePair.slice();
        trial.recall_probe_correct_answer = !!classifiedProbe.truth;

        if (usedRecallProbeEdgeKeys) {
          usedRecallProbeEdgeKeys.add(
            canonicalUndirectedEdgeKey(classifiedProbe.nodePair[0], classifiedProbe.nodePair[1])
          );
        }

        trial.data = {
          ...trial.data,
          trial_mode: "recall_probe",
          problem_idx: sampledItem.trial_idx,
          sampled_test_order: lastTask.sampled_test_order ?? null,

          recall_probe_family: classifiedProbe.probe_family,
          recall_probe_analysis_class: classifiedProbe.analysis_probe_class,
          recall_probe_truth: classifiedProbe.truth,
          recall_probe_nodes_raw: classifiedProbe.nodePair.slice(),
          recall_probe_nodes_displayed: classifiedProbe.nodePair.map(n => subject_mapping[n] ?? n),

          recall_probe_cached_route_label: classifiedProbe.cached_route_label ?? null,
          recall_probe_is_shared_cached_edge: classifiedProbe.is_shared_cached_edge ?? null,
          recall_probe_branch_parent_node: classifiedProbe.branch_parent_node ?? null,

          recall_probe_schedule_index_unshuffled: classifiedProbe.schedule_index_unshuffled ?? null,
          recall_probe_schedule_index_shuffled: classifiedProbe.schedule_index_shuffled ?? null,

          preceding_task_trial_number: lastTask.trial_number ?? null,
          preceding_cached_solution_chosen_label: lastTask.cached_solution_chosen_label ?? null,
          preceding_submitted_path_string: lastTask.submitted_path_string ?? null,
          preceding_submitted_path_string_displayed: lastTask.submitted_path_string_displayed ?? null,
        };
      },

      on_finish: function(data) {
        data.mapping = subject_mapping;
        data.ring_order = layout.ring_order.slice();
        //console.log("Finished recall probe:", data);
      }
    }]
  };
}








// Bonus computation
function logBalanceStats(setName, setObj, pathLengthTag = "path[4]") {
  const rows = setObj.sampledRows;
  const [p1, p2] = setObj.cachedSolutions;

  const lossCol1 = `loss::${pathLengthTag} ${p1}`;
  const lossCol2 = `loss::${pathLengthTag} ${p2}`;

  let nP1Better = 0;
  let nP2Better = 0;
  let nUnknown = 0;

  rows.forEach((row, i) => {
    const loss1 = Number(row[lossCol1]);
    const loss2 = Number(row[lossCol2]);

    if (!Number.isFinite(loss1) || !Number.isFinite(loss2)) {
      nUnknown++;
      return;
    }

    if (loss1 < loss2) {
      nP1Better++;
    } else if (loss1 > loss2) {
      nP2Better++;
    } else {
      nUnknown++;
    }
  });

  const total = rows.length;

  const pct = (x) => total > 0 ? (x / total).toFixed(3) : "NaN";

  console.log(`--- ${setName} balance ---`);
  console.log(`Total trials: ${total}`);
  console.log(`p1 < p2: ${nP1Better} (${pct(nP1Better)})`);
  console.log(`p1 > p2: ${nP2Better} (${pct(nP2Better)})`);
  console.log(`unknown/ties: ${nUnknown} (${pct(nUnknown)})`);
}

function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

function computeTrialBonusUnclippedFromLoss(lossValue, bonusCfg) {
  if (!Number.isFinite(lossValue)) { // Time limit exceeded
    return(0)
  }

  const remainingMoney = bonusCfg.initialBudget - lossValue;
  const denom = bonusCfg.normalizedMax - bonusCfg.normalizedMin;

  if (!(denom > 0)) {
    throw new Error("Invalid bonus config: normalizedMax must exceed normalizedMin.");
  }

  return (
    bonusCfg.maxDollars *
    (remainingMoney - bonusCfg.normalizedMin) /
    denom
  );
}

function computeFinalMeanClippedBonus(unclippedTrialBonuses, bonusCfg) {
  const valid = unclippedTrialBonuses.filter(x => Number.isFinite(x));

  if (valid.length === 0) {
    return {
      meanUnclippedBonus: null,
      meanClippedBonus: 0
    };
  }

  const meanUnclippedBonus =
    valid.reduce((a, b) => a + b, 0) / valid.length;

  const meanClippedBonus = clamp(
    meanUnclippedBonus,
    0,
    bonusCfg.maxDollars
  );

  return {
    meanUnclippedBonus,
    meanClippedBonus
  };
}


