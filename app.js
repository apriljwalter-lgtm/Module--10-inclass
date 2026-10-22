// Explain the Model: three simple, colorful explainers built on the supplied model outputs.
// Every number comes from outputs/<key>.json or the m10.js helpers; nothing is retrained or hard-coded.
import * as m10 from "./m10.js";

const LABELS = { glucose: "Fasting glucose (mg/dL)", sbp: "Blood pressure (mmHg)", fev1: "Lung function, FEV₁ (mL)" };
const state = { key: "glucose", person: "P1", values: null, nTrees: 10, round: 1 };
const $ = (id) => document.getElementById(id);
// toFixed rounds the same way as the starter and check.md (e.g. 1982.55 → 1982.5); then add thousands commas.
const fmt = (v, d = 1) => {
  const [i, f] = Math.abs(Number(v)).toFixed(d).split(".");
  return (Number(v) < 0 && Number(`${i}.${f || 0}`) !== 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
};
const signed = (v, d = 1) => (v >= 0 ? "+" : "−") + fmt(Math.abs(v), d);
const sum = (arr) => arr.reduce((a, c) => a + c, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Charts are drawn at the card's real width so their text stays readable on phones.
const chartW = () => clamp(($("section").clientWidth || 720) - 36, 300, 760);

function section() {
  const s = location.hash.slice(1);
  return ["linear", "forest", "boosting"].includes(s) ? s : "linear";
}

async function setup() {
  // Optional link parameters, e.g. ?ds=sbp&p=P2#linear
  const q = new URLSearchParams(location.search);
  if (m10.DATASETS.includes(q.get("ds"))) state.key = q.get("ds");
  if (/^P[1-5]$/.test(q.get("p") || "")) state.person = q.get("p");
  $("dataset").innerHTML = m10.DATASETS.map((k) => `<option value="${k}">${LABELS[k]}</option>`).join("");
  $("dataset").onchange = async (e) => { state.key = e.target.value; await loadPeople(); render(); };
  $("person").onchange = (e) => { state.person = e.target.value; state.values = null; render(); };
  window.onhashchange = render;
  let lastW = chartW(), timer;
  window.onresize = () => { clearTimeout(timer); timer = setTimeout(() => { if (chartW() !== lastW) { lastW = chartW(); render(); } }, 200); };
  await loadPeople();
  render();
}

async function loadPeople() {
  const b = await m10.loadBundle(state.key);
  $("person").innerHTML = b.people
    .map((p) => `<option value="${p.id}">${p.label}: ${p.description} (${p.why_chosen})</option>`).join("");
  $("dataset").value = state.key;
  $("person").value = state.person;
  state.values = null;
}

async function render() {
  const sec = section();
  document.body.dataset.sec = sec;
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.hash === "#" + sec));
  const b = await m10.loadBundle(state.key);
  const person = b.people.find((p) => p.id === state.person);
  if (!state.values) state.values = { ...person.values };
  ({ linear: renderLinear, forest: renderForest, boosting: renderBoosting })[sec](b, person);
}

const featureOf = (b, name) => b.features.find((f) => f.name === name) || { label: name, units: "" };
const shortLabel = (b, name) => {
  const g = b.categorical_groups.find((g) => g.name === name);
  return g ? g.label : featureOf(b, name).label.split(" (")[0];
};

// Evenly spaced axis ticks with round numbers.
function ticks(lo, hi, count = 5) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}
const tickDigits = (ts) => (ts.length > 1 && ts[1] - ts[0] < 1 ? 1 : 0);

// ============================================================================
// ➕ Push & Pull (linear regression)
// ============================================================================
function renderLinear(b, person) {
  const groups = b.categorical_groups;
  const grouped = new Set(groups.flatMap((g) => g.levels.filter((lv) => lv.column).map((lv) => lv.column)));
  const numeric = b.features.filter((f) => !grouped.has(f.name));
  $("section").innerHTML = `
    <h2>➕ Push &amp; Pull</h2>
    <p class="lead">Start at the average. Each feature then pushes the prediction up ▲ or down ▼.</p>
    <div class="card" id="lin-main"></div>
    <div class="card soft" id="lin-coef"></div>
    <details class="card">
      <summary>✏️ Change this person's values</summary>
      <div class="inputs">
        ${numeric.map((f) => {
          const s = b.feature_stats[f.name];
          return `<label>${shortLabel(b, f.name)} (${f.units})<input type="number" data-f="${f.name}" value="${state.values[f.name]}"
            min="${s.min}" max="${s.max}" step="any"></label>`;
        }).join("")}
        ${groups.map((g) => `<label>${g.label} <span style="font-weight:400">(reference group: ${g.reference})</span><select data-g="${g.name}">${g.levels
          .map((lv) => `<option ${lv.label === m10.categoryOf(b, g.name, state.values) ? "selected" : ""}>${lv.label}</option>`)
          .join("")}</select></label>`).join("")}
      </div>
      <p class="note">Pushes are measured from the training average, which mixes all groups, so even the reference group gets a small push.</p>
      <button id="lin-reset">Reset to ${person.label}</button>
    </details>`;

  const update = () => {
    const ex = m10.linearExplain(b, state.values);
    const edited = Object.keys(person.values).some((k) => Math.abs(person.values[k] - state.values[k]) > 1e-9);
    $("lin-main").innerHTML = waterfall(b, ex) + (edited ? `<p class="note">✏️ Edited values: this is no longer a real survey participant.</p>` : "")
      + (!edited && b.id === "fev1" && person.values.age < 18
        ? `<p class="note">⚠️ Measured: ${fmt(person.observed)} ${b.units}. A straight line can't follow lungs growing in childhood and shrinking later, so it predicts far too much for this child.</p>` : "");
    $("lin-coef").innerHTML = coefficientNote(b, ex);
  };
  document.querySelectorAll("[data-f]").forEach((el) =>
    (el.oninput = () => { if (el.value !== "" && Number.isFinite(Number(el.value))) { state.values[el.dataset.f] = Number(el.value); update(); } }));
  document.querySelectorAll("[data-g]").forEach((el) =>
    (el.onchange = () => { Object.assign(state.values, m10.categoryInputs(b, el.dataset.g, el.value)); update(); }));
  $("lin-reset").onclick = () => { state.values = null; render(); };
  update();
}

function biggestUp(pushes) {
  const ups = Object.entries(pushes).filter(([, v]) => v > 0).sort((a, c) => c[1] - a[1]);
  return ups.length ? ups[0][0] : null;
}

function waterfall(b, ex) {
  const u = b.units;
  const top = biggestUp(ex.groupedPushes);
  let run = ex.baseline;
  const steps = Object.entries(ex.groupedPushes).map(([name, v]) => { const from = run; run += v; return { name, v, from, to: run }; });
  let lo = Math.min(ex.baseline, ...steps.map((s) => s.to)), hi = Math.max(ex.baseline, ...steps.map((s) => s.to));
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const pos = (v) => (100 * (v - lo)) / (hi - lo);
  const detail = (name) => {
    const g = b.categorical_groups.find((g) => g.name === name);
    return g ? m10.categoryOf(b, name, state.values) : `${fmt(state.values[name])} ${featureOf(b, name).units} (avg ${fmt(b.linear.reference[name])})`;
  };
  const rows = steps.map((s) => `
    <div class="lbl">${shortLabel(b, s.name)}${s.name === top ? `<span class="star">★ biggest push up</span>` : ""}<small>${detail(s.name)}</small></div>
    <div class="track"><div class="bar ${s.v >= 0 ? "up" : "down"}" style="left:${pos(Math.min(s.from, s.to))}%;width:${Math.abs(pos(s.to) - pos(s.from))}%"></div></div>
    <div class="val ${s.v >= 0 ? "up" : "down"}">${s.v >= 0 ? "▲" : "▼"} ${signed(s.v)}</div>`).join("");
  return `
    <div class="wf">
      <div class="lbl">Starting point<small>prediction for an average person</small></div>
      <div class="track"><div class="pin" style="left:${pos(ex.baseline)}%"></div></div>
      <div class="val">${fmt(ex.baseline)} ${u}</div>
      ${rows}
      <div class="lbl" style="color:var(--c)">Prediction</div>
      <div class="track"><div class="pin end" style="left:${pos(ex.prediction)}%"></div></div>
      <div class="val" style="color:var(--c)">${fmt(ex.prediction)} ${u}</div>
    </div>
    <div class="eq"><span class="chip start">${fmt(ex.baseline)}</span>
      ${steps.map((s) => `<span class="op">${s.v >= 0 ? "+" : "−"}</span><span class="chip ${s.v >= 0 ? "up" : "down"}" title="${shortLabel(b, s.name)}">${fmt(Math.abs(s.v))}</span>`).join("")}
      <span class="op">=</span><span class="chip total">${fmt(ex.prediction)} ${u}</span></div>
    <p class="note">Starting point + every push = the prediction. Pushes are in ${u}.</p>`;
}

// One short, concrete explanation of coefficient vs push, using the feature that pushes up the most.
function coefficientNote(b, ex) {
  const u = b.units;
  const lin = b.linear;
  const name = biggestUp(ex.groupedPushes) || Object.keys(ex.groupedPushes)[0];
  const push = ex.groupedPushes[name];
  const g = b.categorical_groups.find((g) => g.name === name);
  let text;
  if (!g) {
    const f = featureOf(b, name);
    const c = lin.coefficients[name];
    text = `The <b>coefficient</b> for ${shortLabel(b, name).toLowerCase()} is <b>${signed(c, 3)} ${u} per ${f.units === "years" ? "year" : f.units}</b>:
      one number, the same for everyone. This person's <b>push</b> is ${fmt(c, 3)} × (${fmt(state.values[name])} − ${fmt(lin.reference[name])} average)
      = <b>${signed(push)} ${u}</b>, just for them.`;
  } else {
    const mine = m10.categoryOf(b, name, state.values);
    const lv = g.levels.find((l) => l.column && l.label === mine) || g.levels.filter((l) => l.column).sort((a, c) => Math.abs(lin.coefficients[c.column]) - Math.abs(lin.coefficients[a.column]))[0];
    text = `The <b>coefficient</b> for ${lv.label} is <b>${signed(lin.coefficients[lv.column], 2)} ${u}</b> compared with ${g.reference} (the reference group):
      the same for everyone. This person (${mine}) gets a <b>push</b> of <b>${signed(push)} ${u}</b>, measured from the training average mix of groups.`;
  }
  return `<h3>🔑 A coefficient is not a push</h3><p>${text}</p>
    <p>⚠️ One person's biggest push isn't the most important feature overall. Pushes depend on how far this person is from the average.</p>`;
}

// ============================================================================
// 🌳 Wisdom of the Forest (random forest)
// ============================================================================
const CANDY = ["#ff5a5f", "#ff9f1c", "#ffd23f", "#2ec4b6", "#3a86ff", "#8338ec", "#ff006e", "#06d6a0"];

function renderForest(b, person) {
  const rf = b.forest;
  const trees = rf.people[person.id].tree_predictions;
  const N = rf.n_trees;
  const avgUnique = sum(rf.bootstrap_unique_training_rows) / rf.bootstrap_unique_training_rows.length;
  const n = clamp(Number(state.nTrees || 10), 1, N);
  $("section").innerHTML = `
    <h2>🌳 Wisdom of the Forest</h2>
    <p class="lead">Like a crowd guessing the jellybeans in a jar: ${N} trees each make a guess, and the forest takes the average.</p>
    <div class="card">
      <h3>🫙 Each bean is one tree's guess for ${person.label}</h3>
      <label><b>Trees counted: <span id="ntrees-value">${n}</span> of ${N}</b>
        <input id="ntrees" type="range" min="1" max="${N}" value="${n}" aria-label="Number of trees averaged"></label>
      <div class="row">${[1, 5, 20, N].map((k) => `<button data-n="${k}">${k === N ? `All ${N}` : k === 1 ? "1 tree" : `${k} trees`}</button>`).join("")}</div>
      <div id="forest-results"></div>
    </div>
    <div class="grid2">
      <div class="card soft">
        <h3>🎲 Why do the trees disagree?</h3>
        <p>Each tree learns from its own random sample of people (about ${Math.round((100 * avgUnique) / rf.n_training_rows)}% of the training
          people, some picked twice).</p>
        <p>At each yes/no question, it may only look at ${rf.features_tried_per_split} of the ${rf.n_features} features, chosen at random.</p>
      </div>
      <div class="card soft">
        <h3>🤔 Disagreement ≠ uncertainty</h3>
        <p>The trees' guesses for this person range from <b>${fmt(Math.min(...trees))} to ${fmt(Math.max(...trees))} ${b.units}</b>.
          That spread is <b>disagreement between trees</b>, not a confidence interval. The trees learned from overlapping people, so it doesn't
          tell you how far off the forest might be.</p>
      </div>
    </div>`;
  const update = (k) => {
    state.nTrees = k;
    $("ntrees-value").textContent = k;
    $("ntrees").value = k;
    document.querySelectorAll("[data-n]").forEach((el) => el.classList.toggle("on", Number(el.dataset.n) === k));
    $("forest-results").innerHTML = jar(b, person, trees, k);
  };
  $("ntrees").oninput = (e) => update(Number(e.target.value));
  document.querySelectorAll("[data-n]").forEach((el) => (el.onclick = () => update(Number(el.dataset.n))));
  update(n);
}

// The jar: one bean per tree, stacked by value; beans not counted yet are faded.
function jar(b, person, trees, k) {
  const u = b.units;
  const N = trees.length;
  const partial = m10.runningAverage(trees, k);
  const full = b.forest.people[person.id].prediction;
  let lo = Math.min(...trees), hi = Math.max(...trees);
  const pad = (hi - lo) * 0.05 || 1;
  lo -= pad; hi += pad;
  const W = chartW(), L = 10, R = 10, beanW = 14;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const cols = {};
  const beans = trees.map((t, i) => {
    const c = Math.round(x(t) / beanW);
    cols[c] = (cols[c] || 0) + 1;
    return { i, t, cx: c * beanW, level: cols[c] - 1 };
  });
  const maxStack = Math.max(...Object.values(cols));
  const beanH = 10, top = 26, base = top + maxStack * beanH + 6, H = base + 36;
  const y = (lvl) => base - 7 - lvl * beanH;
  const ts = ticks(lo, hi, 5), d = tickDigits(ts);
  const runs = trees.map((_, i) => m10.runningAverage(trees, i + 1));
  const lateDrift = Math.max(...runs.slice(49)) - Math.min(...runs.slice(49));
  const label = k < N ? `Partial forest (${k} of ${N} trees)` : `Whole forest (all ${N} trees)`;
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${N} tree guesses as jellybeans; ${label} average ${fmt(partial)} ${u}">
      <line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" stroke="#d8d0c4" stroke-width="2"/>
      ${ts.map((t) => `<text x="${x(t)}" y="${base + 18}" text-anchor="middle">${fmt(t, d)}</text>`).join("")}
      <text x="${W - R}" y="${base + 34}" text-anchor="end">tree guess (${u})</text>
      ${beans.map((bn) => `<ellipse cx="${bn.cx}" cy="${y(bn.level)}" rx="6.5" ry="4.6" transform="rotate(-20 ${bn.cx} ${y(bn.level)})"
        fill="${CANDY[bn.i % CANDY.length]}" opacity="${bn.i < k ? 1 : 0.13}"><title>Tree ${bn.i + 1}: ${fmt(bn.t)} ${u}</title></ellipse>`).join("")}
      <line x1="${x(partial)}" x2="${x(partial)}" y1="${top - 14}" y2="${base}" stroke="var(--c)" stroke-width="4" stroke-linecap="round"/>
      <text x="${x(partial)}" y="${top - 18}" text-anchor="${x(partial) > W - 90 ? "end" : x(partial) < 90 ? "start" : "middle"}" style="fill:var(--c);font-weight:700">average ${fmt(partial)}</text>
    </svg>
    <div class="tiles">
      <div class="tile"><small>${label}</small><b>${fmt(partial)} ${u}</b></div>
      <div class="tile"><small>Forest prediction (all ${N} trees)</small><b>${fmt(full)} ${u}</b></div>
      <div class="tile plain"><small>Tree 1 alone</small><b>${fmt(trees[0])} ${u}</b></div>
    </div>
    <p>💡 <b>Why the average is steadier:</b> each tree's quirks push its guess too high or too low, and across ${N} trees those quirks partly cancel.
      Single trees here differ by up to ${fmt(Math.max(...trees) - Math.min(...trees))} ${u}, but after 50 trees the average only moves within
      ${fmt(lateDrift)} ${u}.</p>`;
}

// ============================================================================
// 🔨 One Correction at a Time (gradient boosting)
// ============================================================================
function renderBoosting(b, person) {
  const gb = b.boosting;
  const p = gb.people[person.id];
  const M = p.corrections.length;
  const best = gb.best_validation_round;
  const r = clamp(Number(state.round ?? 1), 0, M);
  $("section").innerHTML = `
    <h2>🔨 One Correction at a Time</h2>
    <p class="lead">Like a sculptor: start with a rough block (the average), then each round chips off part of what's still wrong.</p>
    <div class="card">
      <h3>🪨 Round by round for ${person.label}</h3>
      <label><b>Round <span id="round-value">${r}</span> of ${M}</b>
        <input id="round" type="range" min="0" max="${M}" value="${r}" aria-label="Boosting round"></label>
      <div class="row"><button data-step="-1">◀ Back</button><button data-step="1">Next round ▶</button>
        <span class="note">Jump to</span><button data-r="0">0</button><button data-r="1">1</button><button data-r="${best}">${best}</button><button data-r="${M}">${M}</button></div>
      <div id="boost-step"></div>
      <p class="note">Each small tree is fitted to the <b>training residuals</b>: what earlier rounds still got wrong for the training people.
        Each chip is already shrunk by the learning rate (${gb.learning_rate}).</p>
    </div>
    <div class="card">
      <h3>🛑 When should the sculptor stop?</h3>
      <div id="boost-error"></div>
      <div id="boost-verdict"></div>
      <p class="note">The stopping round is chosen with the validation people, so it's a validation-based choice, not a test result.</p>
    </div>`;
  const update = (k) => {
    state.round = k;
    $("round-value").textContent = k;
    $("round").value = k;
    document.querySelectorAll("[data-r]").forEach((el) => el.classList.toggle("on", Number(el.dataset.r) === k));
    $("boost-step").innerHTML = stepTiles(b, p, person, k);
    $("boost-error").innerHTML = errorChart(b, k);
    $("boost-verdict").innerHTML = verdict(b, k);
  };
  $("round").oninput = (e) => update(Number(e.target.value));
  document.querySelectorAll("[data-step]").forEach((el) => (el.onclick = () => update(clamp(state.round + Number(el.dataset.step), 0, M))));
  document.querySelectorAll("[data-r]").forEach((el) => (el.onclick = () => update(Number(el.dataset.r))));
  update(r);
}

function stepTiles(b, p, person, k) {
  const u = b.units;
  if (k === 0) {
    return `<div class="step"><div class="tile"><small>Round 0: the rough block (training average)</small><b>${fmt(b.boosting.init)} ${u}</b></div></div>`;
  }
  const c = p.corrections[k - 1];
  const away = c !== 0 && Math.sign(c) !== Math.sign(person.observed - p.staged[k - 1]);
  return `<div class="step">
      <div class="tile plain"><small>After round ${k - 1}</small><b>${fmt(p.staged[k - 1])}</b></div>
      <span class="op">${c >= 0 ? "+" : "−"}</span>
      <div class="tile plain"><small>Chip from tree ${k}</small><b class="${c >= 0 ? "up" : "down"}">${fmt(Math.abs(c), 2)}</b></div>
      <span class="op">=</span>
      <div class="tile"><small>After round ${k}</small><b>${fmt(p.staged[k])} ${u}</b></div>
    </div>
    ${away ? `<p class="note">↩️ This chip moved ${person.label} away from their measured value (${fmt(person.observed)} ${u}). Rounds improve the overall error, not every person every time.</p>` : ""}`;
}

// Stretched round axis so the early rounds, where most of the change happens, get room.
const roundX = (m, M, L, W) => L + (Math.log10(1 + m) / Math.log10(1 + M)) * W;

function errorChart(b, k) {
  const u = b.units;
  const gb = b.boosting;
  const tr = gb.rmse.train, va = gb.rmse.validation;
  const M = tr.length - 1, best = gb.best_validation_round;
  const W = chartW(), H = 250, L = 56, R = 14, T = 22, B = 40, plotW = W - L - R;
  let lo = Math.min(...tr, ...va), hi = Math.max(...tr, ...va);
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const x = (m) => roundX(m, M, L, plotW);
  const line = (arr) => arr.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const yt = ticks(lo, hi, 4), d = tickDigits(yt);
  return `<div class="legend"><span><i style="border-color:#9aa0b8"></i>training error</span>
      <span><i style="border-color:#ff006e"></i>validation error (new people)</span><span>⭐ lowest validation error</span>
      <span><i style="border-color:var(--c)"></i>your round</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Training and validation RMSE by round">
      ${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#eee7dd"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, d)}</text>`).join("")}
      <path d="${line(tr)}" fill="none" stroke="#9aa0b8" stroke-width="3"/>
      <path d="${line(va)}" fill="none" stroke="#ff006e" stroke-width="3.5"/>
      <line x1="${x(k)}" x2="${x(k)}" y1="${T}" y2="${H - B}" stroke="var(--c)" stroke-width="3"/>
      <text x="${x(best)}" y="${y(gb.best_validation_rmse) + 6}" text-anchor="middle" style="font-size:20px">⭐</text>
      ${[0, 1, 5, 20, 100, 500].filter((t) => t <= M).map((t) => `<text x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t}</text>`).join("")}
      <text x="${L + plotW / 2}" y="${H - 4}" text-anchor="middle">round (early rounds stretched out)</text>
      <text x="14" y="${T + (H - T - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + (H - T - B) / 2})">RMSE (${u})</text>
    </svg>`;
}

function verdict(b, k) {
  const u = b.units;
  const gb = b.boosting;
  const best = gb.best_validation_round, bestV = gb.best_validation_rmse;
  const v = gb.rmse.validation[k], t = gb.rmse.train[k];
  const close = v - bestV <= 0.02 * bestV;
  const text = k === best ? `✅ This is the round with the lowest validation error. A good place to stop.`
    : k < best ? `${close ? "👍" : "⏳"} Too early: more chips would still help on new people.`
    : `${close ? "👍" : "⚠️"} Past round ${best}, training error keeps falling but validation error goes back up. The extra chips are carving noise (overfitting).`;
  return `<div class="tiles">
      <div class="tile"><small>Validation error at round ${k}</small><b>${fmt(v)} ${u}</b></div>
      <div class="tile"><small>Lowest validation error</small><b>${fmt(bestV)} ${u}</b><small>at round ${best}</small></div>
      <div class="tile plain"><small>Training error at round ${k}</small><b>${fmt(t)} ${u}</b></div>
    </div>
    <div class="verdict ${k === best || close ? "good" : "bad"}">${text} Don't pick the round with the lowest <i>training</i> error: that's always the last one, the most overfit.</div>`;
}

setup();
