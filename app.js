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
  if (/^\d+$/.test(q.get("r") || "")) state.round = Number(q.get("r"));
  if (/^\d+$/.test(q.get("n") || "")) state.nTrees = Number(q.get("n"));
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
// 🎚️ Push & Pull (linear regression)
// ============================================================================
function renderLinear(b, person) {
  const groups = b.categorical_groups;
  const grouped = new Set(groups.flatMap((g) => g.levels.filter((lv) => lv.column).map((lv) => lv.column)));
  const numeric = b.features.filter((f) => !grouped.has(f.name));
  $("section").innerHTML = `
    <h2>🎚️ Push &amp; Pull</h2>
    <p class="lead">Like a sound mixing board: the output starts at the average. Each feature is a fader that pushes the
      prediction up ▲ or down ▼ from the middle line. Output = starting point + every fader. <b>Drag a fader to try it!</b></p>
    <div class="card">
      <div id="lin-mixer"></div>
      <div class="person-panel">
          <h3>🧑 ${person.label} <span class="note" id="lin-who"></span>
            <span class="note" style="font-weight:400">· change a value and watch that fader move</span></h3>
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
          <button id="lin-reset">Reset</button>
      </div>
    </div>
    <div class="card"><h3>🧾 The exact numbers</h3><div id="lin-main"></div></div>
    <div class="card soft" id="lin-coef"></div>`;

  let drag = null, lastScale = 1;
  const update = () => {
    const ex = m10.linearExplain(b, state.values);
    const edited = Object.keys(person.values).some((k) => Math.abs(person.values[k] - state.values[k]) > 1e-9);
    $("lin-who").textContent = edited ? "(edited)" : `(${person.description})`;
    // While dragging, the fader scale is frozen so the board doesn't rescale under the pointer.
    lastScale = drag ? drag.scale : Math.max(...Object.values(ex.groupedPushes).map(Math.abs)) || 1;
    $("lin-mixer").innerHTML = mixer(b, ex, lastScale);
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

  // Dragging a fader: its height is a push; turn that push back into the feature value that gives it
  // (value = training average + push ÷ coefficient). Categories snap to the level with the nearest push.
  const lin = b.linear;
  const fromPointer = (e) => {
    const svg = $("lin-mixer").querySelector("svg");
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const y = pt.matrixTransform(svg.getScreenCTM().inverse()).y;
    const push = clamp((MIX.mid - y) / MIX.travel, -1, 1) * drag.scale;
    const g = groups.find((g) => g.name === drag.name);
    if (g) {
      const pushOf = (level) => {
        const x = m10.categoryInputs(b, g.name, level);
        return sum(Object.keys(x).map((c) => lin.coefficients[c] * (x[c] - lin.reference[c])));
      };
      const level = g.levels.map((lv) => lv.label).sort((a, c) => Math.abs(pushOf(a) - push) - Math.abs(pushOf(c) - push))[0];
      Object.assign(state.values, m10.categoryInputs(b, g.name, level));
      document.querySelector(`[data-g="${g.name}"]`).value = level;
    } else {
      const c = lin.coefficients[drag.name];
      if (Math.abs(c) < 1e-12) return;
      const s = b.feature_stats[drag.name];
      const v = Math.round(clamp(lin.reference[drag.name] + push / c, s.min, s.max) * 10) / 10;
      state.values[drag.name] = v;
      document.querySelector(`[data-f="${drag.name}"]`).value = v;
    }
    update();
  };
  // The board redraws while dragging, so the pointer is captured by the (permanent) container, not the fader.
  const board = $("lin-mixer");
  const end = () => { if (drag) { drag = null; update(); } };
  board.onpointerdown = (e) => {
    const t = e.target.closest("[data-fader]");
    if (!t) return;
    e.preventDefault();
    drag = { name: t.dataset.fader, scale: lastScale };
    board.setPointerCapture(e.pointerId);
    fromPointer(e);
  };
  board.onpointermove = (e) => { if (drag) fromPointer(e); };
  board.onpointerup = end;
  board.onpointercancel = end;
  board.onlostpointercapture = end;
  update();
}

const NICK = { hba1c: "HbA1c", age: "Age", bmi: "BMI", waist_cm: "Waist", income_poverty_ratio: "Income", sex: "Sex", ethnicity: "Ethnicity" };
const KNOBS = ["#ff5a5f", "#ffd23f", "#2ec4b6", "#3a86ff", "#8338ec", "#ff9f1c"];

// Mixing board: one fader per feature. A fader above the middle line pushes the prediction up, below pushes it down;
// the biggest push in this view reaches the end of its track. The output display = starting point + all faders.
const MIX = { mid: 172, travel: 92 };

function mixer(b, ex, maxAbs) {
  const u = b.units;
  const entries = Object.entries(ex.groupedPushes);
  const top = biggestUp(ex.groupedPushes);
  const { mid, travel } = MIX;
  const W = 680, H = 362, x0 = 40, x1 = 470;
  const gap = Math.min(92, (x1 - x0) / entries.length);
  const startX = x0 + ((x1 - x0) - gap * entries.length) / 2;
  const channels = entries.map(([name, v], i) => {
    const x = startX + gap * (i + 0.5);
    const ky = mid - clamp(v / maxAbs, -1, 1) * travel;
    const color = v >= 0 ? "#ff7a45" : "#4da3ff";
    return `
      <circle cx="${x}" cy="56" r="11" fill="${KNOBS[i % KNOBS.length]}"/><line x1="${x}" x2="${x + 6}" y1="56" y2="49" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="${x - 4}" y="${mid - travel - 6}" width="8" height="${2 * travel + 12}" rx="4" fill="#15162a"/>
      <rect x="${x - 4}" y="${Math.min(ky, mid)}" width="8" height="${Math.abs(ky - mid)}" rx="3" fill="${color}" style="filter:drop-shadow(0 0 4px ${color})"/>
      <rect x="${x - 19}" y="${ky - 9}" width="38" height="18" rx="5" fill="#e9e9f2" stroke="${color}" stroke-width="3"/>
      <line x1="${x - 12}" x2="${x + 12}" y1="${ky}" y2="${ky}" stroke="#2b2d42" stroke-width="2"/>
      <text x="${x}" y="${mid + travel + 30}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:14px">${NICK[name] || shortLabel(b, name)}</text>
      <text x="${x}" y="${mid + travel + 48}" text-anchor="middle" style="fill:${color};font-weight:700;font-size:14px">${v >= 0 ? "▲" : "▼"} ${signed(v)}</text>
      ${name === top ? `<text x="${x}" y="${mid + travel + 64}" text-anchor="middle" style="fill:#ffd43b;font-weight:700;font-size:11px">★ biggest push up</text>` : ""}
      <rect class="fader-hit" data-fader="${name}" x="${x - 24}" y="${mid - travel - 14}" width="48" height="${2 * travel + 28}" fill="transparent"><title>Drag to change ${shortLabel(b, name)}</title></rect>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mixing board: starting point ${fmt(ex.baseline)} plus one fader per feature gives the prediction ${fmt(ex.prediction)} ${u}">
    <defs><linearGradient id="deck" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#34365a"/><stop offset="1" stop-color="#22233d"/></linearGradient></defs>
    <rect x="0" y="0" width="${W}" height="${H}" rx="22" fill="url(#deck)"/>
    <text x="${x0 - 22}" y="${mid - travel + 4}" style="fill:#ff7a45;font-weight:700;font-size:13px">▲</text>
    <text x="${x0 - 22}" y="${mid + travel + 4}" style="fill:#4da3ff;font-weight:700;font-size:13px">▼</text>
    <line x1="${x0 - 8}" x2="${x1 + 8}" y1="${mid}" y2="${mid}" stroke="#8d90b8" stroke-width="1.5" stroke-dasharray="5 5"/>
    <text x="10" y="${mid - 6}" style="fill:#8d90b8;font-size:10px">no push</text>
    ${channels}
    <rect x="${x1 + 26}" y="26" width="2" height="${H - 52}" fill="#4a4c74"/>
    <text x="${(x1 + 30 + W) / 2}" y="46" text-anchor="middle" style="fill:#c9cbe8;font-weight:700;font-size:13px;letter-spacing:2px">START</text>
    <rect x="${x1 + 46}" y="56" width="${W - x1 - 66}" height="40" rx="8" fill="#0d0e1c"/>
    <text x="${(x1 + 30 + W) / 2 + 2}" y="83" text-anchor="middle" style="fill:#e9e9f2;font-family:ui-monospace,Consolas,monospace;font-weight:700;font-size:20px">${fmt(ex.baseline)}</text>
    <text x="${(x1 + 30 + W) / 2}" y="126" text-anchor="middle" style="fill:#c9cbe8;font-size:13px">+ every fader</text>
    <text x="${(x1 + 30 + W) / 2}" y="146" text-anchor="middle" style="fill:#c9cbe8;font-size:20px">↓</text>
    <text x="${(x1 + 30 + W) / 2}" y="180" text-anchor="middle" style="fill:#ff4fa3;font-weight:700;font-size:13px;letter-spacing:2px">OUTPUT</text>
    <rect x="${x1 + 46}" y="190" width="${W - x1 - 66}" height="52" rx="8" fill="#0d0e1c" stroke="#ff006e" stroke-width="2.5" style="filter:drop-shadow(0 0 6px #ff006e)"/>
    <text x="${(x1 + 30 + W) / 2 + 2}" y="224" text-anchor="middle" style="fill:#ff4fa3;font-family:ui-monospace,Consolas,monospace;font-weight:700;font-size:24px">${fmt(ex.prediction)}</text>
    <text x="${(x1 + 30 + W) / 2}" y="262" text-anchor="middle" style="fill:#c9cbe8;font-size:13px">${u} = prediction</text>
    <text x="${(x0 + x1) / 2}" y="${H - 10}" text-anchor="middle" style="fill:#8d90b8;font-size:12px">drag a fader ↕ · fader height = push in ${u}</text>
  </svg>`;
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
const GREENS = ["#1fa65a", "#2ecc71", "#138d62", "#4cc38a", "#0f7a4a", "#5bd06f", "#20b38a", "#3a9d3a"];

function renderForest(b, person) {
  const rf = b.forest;
  const trees = rf.people[person.id].tree_predictions;
  const N = rf.n_trees;
  const avgUnique = sum(rf.bootstrap_unique_training_rows) / rf.bootstrap_unique_training_rows.length;
  const n = clamp(Number(state.nTrees || 10), 1, N);
  $("section").innerHTML = `
    <h2>🌳 Wisdom of the Forest</h2>
    <p class="lead">Ask ${N} slightly different trees for a guess, then take the average. That's the forest's prediction.</p>
    <div class="card">
      <h3>🌲 ${N} trees guess for ${person.label}</h3>
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
    $("forest-results").innerHTML = forestScene(b, person, trees, k);
  };
  $("ntrees").oninput = (e) => update(Number(e.target.value));
  document.querySelectorAll("[data-n]").forEach((el) => (el.onclick = () => update(Number(el.dataset.n))));
  update(n);
}

// The forest: one pine tree per model tree, in the fixed tree order, each as tall as its guess.
// Trees not counted yet are pale; the bold line is the average of the counted trees.
function forestScene(b, person, trees, k) {
  const u = b.units;
  const N = trees.length;
  const partial = m10.runningAverage(trees, k);
  const full = b.forest.people[person.id].prediction;
  const lo = Math.min(...trees), hi = Math.max(...trees), span = hi - lo || 1;
  const yMin = Math.max(0, lo - span * 0.35), yMax = hi + span * 0.06;
  const W = chartW(), H = 300, L = 50, R = 12, T = 30, ground = H - 40;
  const y = (v) => ground - ((v - yMin) / (yMax - yMin)) * (ground - T);
  const slot = (W - L - R) / N;
  const w = clamp(slot * 2.4, 8, 22);
  const pines = trees.map((t, i) => {
    const cx = L + slot * (i + 0.5), top = y(t), h = ground - top, trunk = h * 0.14, on = i < k;
    const green = GREENS[i % GREENS.length];
    return `<g opacity="${on ? 1 : 0.35}"><title>Tree ${i + 1}: ${fmt(t)} ${u}</title>
      <rect x="${(cx - 1.5).toFixed(1)}" y="${(ground - trunk).toFixed(1)}" width="3" height="${trunk.toFixed(1)}" fill="${on ? "#8b5a2b" : "#c9bba8"}"/>
      <polygon points="${(cx - w * 0.5).toFixed(1)},${(ground - trunk).toFixed(1)} ${(cx + w * 0.5).toFixed(1)},${(ground - trunk).toFixed(1)} ${cx.toFixed(1)},${(top + h * 0.3).toFixed(1)}" fill="${on ? green : "#cfe3d5"}"/>
      <polygon points="${(cx - w * 0.36).toFixed(1)},${(top + h * 0.5).toFixed(1)} ${(cx + w * 0.36).toFixed(1)},${(top + h * 0.5).toFixed(1)} ${cx.toFixed(1)},${top.toFixed(1)}" fill="${on ? green : "#cfe3d5"}"/>
    </g>`;
  }).join("");
  const yt = ticks(yMin, yMax, 4).filter((t) => t >= yMin), d = tickDigits(yt);
  const lineY = y(partial);
  const runs = trees.map((_, i) => m10.runningAverage(trees, i + 1));
  const lateDrift = Math.max(...runs.slice(49)) - Math.min(...runs.slice(49));
  const label = k < N ? `Partial forest (${k} of ${N} trees)` : `Whole forest (all ${N} trees)`;
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${N} trees, each as tall as its guess; ${label} average ${fmt(partial)} ${u}">
      <rect x="${L}" y="${T - 20}" width="${W - L - R}" height="${ground - T + 20}" rx="10" fill="#eefaf3"/>
      ${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#d6eadc"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, d)}</text>`).join("")}
      ${pines}
      <rect x="${L - 4}" y="${ground}" width="${W - L - R + 8}" height="8" rx="4" fill="#9ed8a8"/>
      <text x="${L + slot / 2}" y="${ground + 24}" text-anchor="start">tree 1</text>
      <text x="${W - R}" y="${ground + 24}" text-anchor="end">tree ${N}</text>
      <text x="${(L + W - R) / 2}" y="${ground + 24}" text-anchor="middle">each tree is as tall as its guess (${u})</text>
      ${k < N ? `<line x1="${L}" x2="${W - R}" y1="${y(full)}" y2="${y(full)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.5"/>` : ""}
      <line x1="${L}" x2="${W - R}" y1="${lineY}" y2="${lineY}" stroke="#ff006e" stroke-width="3.5" stroke-linecap="round"/>
      <rect x="${W - R - 132}" y="${lineY - 26}" width="132" height="20" rx="10" fill="#ff006e"/>
      <text x="${W - R - 66}" y="${lineY - 12}" text-anchor="middle" style="fill:#fff;font-weight:700">average ${fmt(partial)}</text>
      <text x="${L + slot / 2}" y="${y(trees[0]) - 6}" text-anchor="middle" style="fill:var(--ink);font-weight:700">1</text>
      <text x="12" y="${(T + ground) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + ground) / 2})">guess (${u})</text>
    </svg>
    <p class="note">Bold pink line = average of the trees counted so far${k < N ? "; dotted line = average of all 100" : ""}. Pale trees aren't counted yet.</p>
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
      <div class="studio">
        <div id="boost-art"></div>
        <div id="boost-caption"></div>
      </div>
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
    const s = sculpt(b, k);
    $("boost-art").innerHTML = s.svg;
    $("boost-caption").innerHTML = s.caption;
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

// ---- The sculptor scene --------------------------------------------------------
// The statue's progress follows the validation error: progress = how much of the drop from round 0 down to the
// lowest validation error has happened by round k (using the lowest value seen so far, so carved marble never grows back).
// At the best round the statue is finished; past it, scratches appear as validation error climbs (over-carving = overfitting).
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCK = { x: 150, y: 26, w: 100, h: 240, cols: 8, rows: 16 };
// Marble chunks covering the statue; outer chunks have lower thresholds, so they fall off first.
const CHUNKS = (() => {
  const r = rng(7);
  const cw = BLOCK.w / BLOCK.cols, ch = BLOCK.h / BLOCK.rows;
  const out = [];
  for (let i = 0; i < BLOCK.cols; i++) for (let j = 0; j < BLOCK.rows; j++) {
    const x0 = BLOCK.x + i * cw, y0 = BLOCK.y + j * ch, jit = () => (r() - 0.5) * 4;
    const pts = [[x0 + jit(), y0 + jit()], [x0 + cw + jit(), y0 + jit()], [x0 + cw + jit(), y0 + ch + jit()], [x0 + jit(), y0 + ch + jit()]];
    const inward = Math.min(i, BLOCK.cols - 1 - i, j * 0.5, (BLOCK.rows - 1 - j) * 0.5) / 4;
    out.push({ pts, t: clamp(0.03 + 0.72 * inward + 0.25 * r(), 0.02, 0.97), shade: r() });
  }
  return out;
})();
const CRACKS = (() => {
  const r = rng(99);
  return Array.from({ length: 12 }, () => {
    let x = 184 + r() * 32, y = 98 + r() * 105, d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    for (let s = 0; s < 3; s++) { x += (r() - 0.5) * 9; y += 3 + r() * 5; d += ` L${x.toFixed(1)},${y.toFixed(1)}`; }
    return d;
  });
})();

// A PG take on Michelangelo's David: contrapposto stance, sling over the raised shoulder, a draped cloth at the hips.
// `detail` (0–1) fades in the carved details (face, curls, muscles, folds) as the statue nears completion.
const CURLS = (() => {
  const out = [];
  for (let a = 196; a <= 344; a += 15) out.push([200 + 15.5 * Math.cos((a * Math.PI) / 180), 46 + 15 * Math.sin((a * Math.PI) / 180), 4.4]);
  for (let a = 215; a <= 325; a += 22) out.push([200 + 8 * Math.cos((a * Math.PI) / 180), 41 + 8 * Math.sin((a * Math.PI) / 180), 4]);
  out.push([185, 52, 3.6], [215, 52, 3.6]);
  return out;
})();

function statue(detail) {
  const dt = detail.toFixed(2);
  return `
    <g filter="url(#statueShadow)">
    <g stroke="#a99f91" stroke-width="0.9" fill="url(#marbleR)" stroke-linejoin="round">
      <path d="M182,198 C180,214 182,226 184,236 C185,244 184,252 184,259 L198,259 C198,250 199,242 199,234 C200,224 201,212 200,200 Z"/>
      <path d="M204,200 C204,214 206,222 210,230 C212,240 214,250 216,259 L229,259 C228,250 226,240 223,230 C222,220 222,208 222,198 Z"/>
      <ellipse cx="190" cy="261" rx="10" ry="4"/><ellipse cx="223" cy="261" rx="10" ry="4"/>
      <path d="M193,60 L193,72 Q200,77 207,72 L207,60 Z"/>
      <path d="M193,72 C184,74 174,76 171,82 C168,90 170,104 174,116 C176,128 177,140 180,150 C181,158 180,166 180,172
        L222,172 C222,164 221,156 222,148 C224,138 226,124 227,114 C230,102 232,90 229,82 C226,76 216,74 207,72 Z"/>
      <path d="M174,80 C164,84 160,100 161,114 C162,126 160,140 161,152 C162,162 163,172 165,180 C168,186 175,186 175,178
        C174,168 172,156 172,146 C173,134 175,122 175,110 C176,100 178,90 178,84 Z"/>
      <ellipse cx="169" cy="183" rx="6" ry="7.5"/>
      <path d="M226,80 C236,84 242,98 241,112 C240,120 236,124 232,122 C230,110 228,100 222,90 Z"/>
      <path d="M241,114 C238,104 230,94 224,88 C221,86 217,90 219,94 C225,100 231,110 233,121 Z"/>
      <ellipse cx="219" cy="88" rx="6" ry="5"/>
      <path d="M178,160 C190,156 210,156 224,158 C226,170 228,186 226,200 C220,206 212,203 206,206 C200,209 194,204 188,207
        C182,209 177,204 174,200 C174,186 176,172 178,160 Z" fill="url(#cloth)"/>
      <path d="M200,30 C211,30 216,38 215,48 C214,56 210,62 200,64 C190,62 186,56 185,48 C184,38 189,30 200,30 Z"/>
      ${CURLS.map(([x, y, r]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`).join("")}
    </g>
    </g>
    <g fill="none" stroke-linecap="round" opacity="${dt}">
      <path d="M219,88 C210,98 201,120 197,150" stroke="#bdb3a5" stroke-width="2.4"/>
      <g stroke="#b4aa9c" stroke-width="1">
        <path d="M191,43 q4,-2 8,0 M201,43 q4,-2 8,0 M200,45 L198,53 q2,1.6 4,0 M196,57.5 q4,1.6 8,0 M189,55 q11,10 22,0"/>
        <path d="M180,104 Q190,111 199,104 M201,104 Q210,111 220,104 M200,96 L200,150 M192,122 q8,3 16,0 M192,134 q8,3 16,0
          M176,84 q6,8 4,18 M226,84 q-6,8 -4,18 M195,74 q-6,4 -14,5 M205,74 q6,4 14,5"/>
        <path d="M184,166 C186,180 184,192 186,204 M196,164 C198,180 196,194 197,206 M208,164 C210,178 208,192 210,205 M218,162 C220,176 220,188 221,200"/>
        <path d="M185,234 q7,3 13,0 M211,230 q6,3 12,0 M165,130 q5,2 9,0"/>
      </g>
      <ellipse cx="200" cy="146" rx="1.4" ry="1.8" fill="#b4aa9c" stroke="none"/>
      <path d="M192,46 q3,-2 6,0 q-3,1.5 -6,0 Z M202,46 q3,-2 6,0 q-3,1.5 -6,0 Z" fill="#b9b0a3" stroke="none"/>
      <ellipse cx="180" cy="166" rx="4" ry="3" fill="#ddd6ca" stroke="#b4aa9c" stroke-width="0.8"/>
      ${CURLS.map(([x, y, r]) => `<path d="M${(x - r * 0.5).toFixed(1)},${(y + r * 0.1).toFixed(1)} q${(r * 0.5).toFixed(1)},${(-r * 0.7).toFixed(1)} ${r.toFixed(1)},0" stroke="#b4aa9c" stroke-width="0.8"/>`).join("")}
      <g stroke="#e3ddd3" stroke-width="0.7" opacity="0.8"><path d="M182,92 q10,20 4,44 M214,110 q-6,24 2,40 M188,214 q4,16 2,30"/></g>
    </g>`;
}

function sculpt(b, k) {
  const u = b.units;
  const gb = b.boosting;
  const va = gb.rmse.validation;
  const best = gb.best_validation_round, bestV = gb.best_validation_rmse;
  const lowSoFar = Math.min(...va.slice(0, k + 1));
  const progress = va[0] === bestV ? 1 : clamp((va[0] - lowSoFar) / (va[0] - bestV), 0, 1);
  const worst = Math.max(...va.slice(best));
  const damage = k > best && worst > bestV ? clamp((va[k] - bestV) / (worst - bestV), 0, 1) : 0;
  const nCracks = Math.round(damage * CRACKS.length);
  const done = k === best;
  const r = rng(k + 1);
  const flying = k === 0 || done ? "" : Array.from({ length: 5 }, () =>
    `<polygon class="fly" points="0,0 4,-2 5,3 1,4" transform="translate(150 ${143 + r() * 8})" fill="#e6e1d8" stroke="#bfb7aa"
      style="--dx:${(-10 - r() * 40).toFixed(0)}px;--dy:${(10 + r() * 50).toFixed(0)}px"/>`).join("");
  const sparkles = done ? [[160, 40], [244, 70], [168, 190], [240, 220], [200, 18]].map(([x, y], i) =>
    `<text class="sparkle" x="${x}" y="${y}" style="font-size:18px;animation-delay:${i * 0.2}s">✨</text>`).join("") : "";
  const svg = `<svg viewBox="30 6 250 292" role="img" aria-label="A sculptor carving a statue; the statue is ${Math.round(progress * 100)}% finished">
    <defs>
      <radialGradient id="marbleR" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#eee9e1"/><stop offset="1" stop-color="#cbc3b6"/></radialGradient>
      <linearGradient id="cloth" x1="0" x2="1" y1="0" y2="0.3"><stop offset="0" stop-color="#f6f2ec"/><stop offset="0.5" stop-color="#e4ddd2"/><stop offset="1" stop-color="#cfc6b9"/></linearGradient>
      <filter id="statueShadow" x="-20%" y="-10%" width="140%" height="125%"><feDropShadow dx="3" dy="3" stdDeviation="2.5" flood-color="#5a4f7a" flood-opacity="0.25"/></filter>
    </defs>
    <rect x="30" y="6" width="250" height="292" rx="18" fill="var(--soft)"/>
    <rect x="30" y="276" width="250" height="22" fill="#ddd3f6"/>
    <ellipse cx="200" cy="284" rx="${(14 + 62 * progress).toFixed(1)}" ry="${(3 + 5 * progress).toFixed(1)}" fill="#e3ddd2"/>
    <rect x="148" y="264" width="104" height="16" rx="4" fill="#cfc6b8"/>
    ${statue(progress ** 1.5)}
    <g stroke="#7d7468" stroke-width="1.3" fill="none">${CRACKS.slice(0, nCracks).map((d) => `<path d="${d}"/>`).join("")}</g>
    ${CHUNKS.filter((c) => c.t > progress).map((c) => `<polygon points="${c.pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}"
      fill="${c.shade > 0.5 ? "#e7e2d9" : "#e1dbd0"}" stroke="${c.shade > 0.5 ? "#e7e2d9" : "#e1dbd0"}" stroke-width="3" stroke-linejoin="round"/>`).join("")}
    <g>
      <rect x="70" y="210" width="10" height="56" rx="4" fill="#3d3a5c"/><rect x="86" y="210" width="10" height="56" rx="4" fill="#3d3a5c"/>
      <ellipse cx="74" cy="268" rx="9" ry="4" fill="#2a2840"/><ellipse cx="92" cy="268" rx="9" ry="4" fill="#2a2840"/>
      <path d="M64,150 Q83,136 102,150 L107,216 L59,216 Z" fill="#ff7a1a"/>
      <path d="M98,160 L140,150" stroke="#f2c7a5" stroke-width="7" stroke-linecap="round"/>
      <path d="M140,150 L153,147" stroke="#8a8f99" stroke-width="3" stroke-linecap="round"/>
      <circle cx="83" cy="128" r="14" fill="#f2c7a5"/>
      <ellipse cx="80" cy="116" rx="15" ry="6" fill="#7b4dff"/><circle cx="80" cy="110" r="2.6" fill="#7b4dff"/>
      <circle cx="90" cy="127" r="1.7" fill="#1f2140"/>
      <path d="${done ? "M84,134 q5,5 10,0" : "M85,135 h8"}" stroke="#1f2140" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <g class="hammer ${done ? "rest" : k > 0 ? "swing" : ""}">
        <path d="M92,156 L118,128" stroke="#f2c7a5" stroke-width="7" stroke-linecap="round"/>
        <path d="M118,128 L129,115" stroke="#8b5a2b" stroke-width="4" stroke-linecap="round"/>
        <rect x="122" y="106" width="17" height="9" rx="2" fill="#5d607a" transform="rotate(40 130 110)"/>
      </g>
    </g>
    ${flying}${sparkles}
  </svg>`;
  const pct = Math.round(progress * 100);
  const caption = k === 0 ? `🪨 <b>Round 0: an uncarved block.</b> Everyone gets the same guess, the training average.`
    : k < best ? `🔨 <b>Chipping away…</b> The statue is <b>${pct}%</b> done, measured by how far the validation error has dropped toward its lowest point.`
    : done ? `✨ <b>Masterpiece!</b> Round ${best} has the lowest validation error. The sculptor puts the hammer down here.`
    : `⚠️ <b>Over-carving!</b> The statue was finished at round ${best}. Extra chips are scratching noise into it: validation error is up ${fmt(va[k] - bestV, 2)} ${u}.`;
  return {
    svg,
    caption: `<p class="caption">${caption}</p>
      <div class="meter" title="Statue progress"><span style="width:${pct}%"></span></div>
      <p class="note">Statue progress (from validation error): ${pct}%${nCracks ? ` · ${nCracks} scratch${nCracks > 1 ? "es" : ""}` : ""}</p>`,
  };
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
