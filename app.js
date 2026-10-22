// Explain the Model: three explainers built on the supplied model outputs.
// Every number comes from outputs/<key>.json or the m10.js helpers; nothing is retrained or hard-coded.
import * as m10 from "./m10.js";

const LABELS = { glucose: "Fasting glucose (mg/dL)", sbp: "Systolic blood pressure (mmHg)", fev1: "Lung function, FEV₁ (mL)" };
const state = { key: "glucose", person: "P1", values: null, nTrees: 10, round: 1, coefFeature: null };
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
const chartW = () => clamp(($("section").clientWidth || 720) - 34, 300, 720);

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
  $("dataset").onchange = async (e) => { state.key = e.target.value; state.coefFeature = null; await loadPeople(); render(); };
  $("person").onchange = (e) => selectPerson(e.target.value);
  window.onhashchange = render;
  let lastW = chartW(), timer;
  window.onresize = () => { clearTimeout(timer); timer = setTimeout(() => { if (chartW() !== lastW) { lastW = chartW(); render(); } }, 200); };
  await loadPeople();
  render();
}

function selectPerson(id) {
  state.person = id;
  state.values = null;
  $("person").value = id;
  render();
}

async function loadPeople() {
  const b = await m10.loadBundle(state.key);
  $("person").innerHTML = b.people
    .map((p) => `<option value="${p.id}">${p.label}: ${p.description} (${p.why_chosen})</option>`).join("");
  $("dataset").value = state.key;
  $("person").value = state.person;
  state.values = null;
  const inputs = b.features.filter((f) => !f.name.startsWith("eth_") && f.name !== "female").map((f) => f.label.split(" (")[0])
    .map((l) => (/^[A-Z][^A-Z]*$/.test(l) ? l[0].toLowerCase() + l.slice(1) : l));
  const cats = b.categorical_groups.map((g) => g.label.toLowerCase());
  $("blurb").textContent = `Predicting ${b.target_label.toLowerCase()} in ${b.units} from ${[...inputs, ...cats].join(", ")}. `
    + `${b.n_train.toLocaleString()} training people, ${b.n_validation.toLocaleString()} validation people. ${b.source}.`;
}

async function render() {
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.hash === "#" + section()));
  const b = await m10.loadBundle(state.key);
  const person = b.people.find((p) => p.id === state.person);
  if (!state.values) state.values = { ...person.values };
  const draw = { linear: renderLinear, forest: renderForest, boosting: renderBoosting }[section()];
  draw(b, person);
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
// Push & Pull (linear regression): a waterfall from the starting point to the prediction
// ============================================================================
function renderLinear(b, person) {
  const u = b.units;
  const groups = b.categorical_groups;
  const grouped = new Set(groups.flatMap((g) => g.levels.filter((lv) => lv.column).map((lv) => lv.column)));
  const numeric = b.features.filter((f) => !grouped.has(f.name));
  $("section").innerHTML = `
    <h2>Push &amp; Pull <span class="tag">linear regression</span></h2>
    <p class="takeaway">The model starts from an average prediction and adds one push per feature.
      Starting point + every push = the prediction.</p>
    <div class="try"><b>Try this:</b> read the waterfall from top to bottom. Each bar starts where the last one ended and
      moves the prediction up (orange) or down (blue). Then change a value below and watch only that feature's push change.</div>

    <div class="card">
      <h3>1. The person <span id="lin-who" class="note"></span></h3>
      <div class="inputs">
        ${numeric.map((f) => {
          const s = b.feature_stats[f.name];
          return `<label>${f.label.split(" (")[0]} (${f.units})<input type="number" data-f="${f.name}" value="${state.values[f.name]}"
            min="${s.min}" max="${s.max}" step="any"></label>`;
        }).join("")}
        ${groups.map((g) => `<label>${g.label}<select data-g="${g.name}">${g.levels
          .map((lv) => `<option ${lv.label === m10.categoryOf(b, g.name, state.values) ? "selected" : ""}>${lv.label}</option>`)
          .join("")}</select></label>`).join("")}
      </div>
      <p><button id="lin-reset">Reset to ${person.label}</button></p>
    </div>

    <div class="card">
      <h3>2. Starting point + pushes = prediction</h3>
      <div id="lin-waterfall"></div>
    </div>

    <div class="grid2">
      <div class="card" id="lin-coef"></div>
      <div class="card" id="lin-general"></div>
    </div>

    <details class="card">
      <summary>Common mix-ups (read these if a number surprises you)</summary>
      <p><b>The starting point is not the intercept.</b> The starting point (${fmt(b.linear.baseline)} ${u}) is the prediction for a
        person who sits at the training average on every feature. The intercept (${fmt(b.linear.intercept)} ${u}) is the prediction
        for someone with every feature at 0 (age 0, BMI 0…), who doesn't exist, so it's not a useful place to start.</p>
      <p><b>Why do men${groups.some((g) => g.name === "ethnicity") ? " and Non-Hispanic White people" : ""} still get a push?</b>
        Pushes are measured from the training average, and that average mixes men and women${groups.some((g) => g.name === "ethnicity") ? " and all ethnic groups" : ""}.
        So every category is a little above or below the mix. The <i>reference group</i>
        (${groups.map((g) => g.reference).join(", ")}) only describes how the 0/1 columns are coded: each category's coefficient
        compares that group with the reference group.</p>
      <p><b>Associations, not causes.</b> A push means "people like this tend to get a higher (or lower) prediction in this data."
        It doesn't mean changing that feature would change the outcome.</p>
      <p><b>A straight line can be wrong.</b> The model adds the same amount per unit of each feature for everyone, so it can't bend.
        Try <i>Lung function → Example person 1</i>: a 9-year-old, whose prediction is far too high.</p>
    </details>`;

  const update = () => {
    const ex = m10.linearExplain(b, state.values);
    const edited = Object.keys(person.values).some((k) => Math.abs(person.values[k] - state.values[k]) > 1e-9);
    $("lin-who").textContent = edited ? `(edited: not a real participant any more)` : `(${person.label}: ${person.description})`;
    $("lin-waterfall").innerHTML = waterfall(b, ex, edited ? null : person);
    if (!state.coefFeature || !(state.coefFeature in ex.groupedPushes)) state.coefFeature = biggestUp(ex.groupedPushes) || Object.keys(ex.groupedPushes)[0];
    $("lin-coef").innerHTML = coefficientCard(b, ex, person, edited);
    $("lin-coef").querySelector("select").onchange = (e) => { state.coefFeature = e.target.value; update(); };
    $("lin-general").innerHTML = generalCard(b, ex);
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

// The value shown next to each feature: a number with units, or the person's category plus the training mix.
function featureDetail(b, name, values) {
  const g = b.categorical_groups.find((g) => g.name === name);
  if (g) return `${m10.categoryOf(b, name, values)}`;
  const f = featureOf(b, name);
  return `${fmt(values[name], 1)} ${f.units} · training avg ${fmt(b.linear.reference[name], 1)}`;
}

function waterfall(b, ex, person) {
  const u = b.units;
  const entries = Object.entries(ex.groupedPushes);
  const top = biggestUp(ex.groupedPushes);
  let run = ex.baseline;
  const steps = entries.map(([name, v]) => { const from = run; run += v; return { name, v, from, to: run }; });
  const pts = [ex.baseline, ex.prediction, ...steps.map((s) => s.to)];
  if (person) pts.push(person.observed);
  let lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const pos = (v) => (100 * (v - lo)) / (hi - lo);
  const guides = `<div class="guide" style="left:${pos(ex.baseline)}%"></div>${person ? `<div class="obs" style="left:${pos(person.observed)}%"></div>` : ""}`;
  const rows = steps.map((s) => {
    const left = pos(Math.min(s.from, s.to)), width = Math.abs(pos(s.to) - pos(s.from));
    return `<div class="lbl ${s.name === top ? "hl" : ""}"><b>${shortLabel(b, s.name)}</b>${s.name === top ? `<span class="badge">biggest push up</span>` : ""}
        <small>${featureDetail(b, s.name, state.values)}</small></div>
      <div class="track">${guides}<div class="bar ${s.v >= 0 ? "up" : "down"}" style="left:${left}%;width:${width}%"
        title="${shortLabel(b, s.name)}: ${signed(s.v)} ${u}"></div></div>
      <div class="val ${s.v >= 0 ? "up" : "down"}">${signed(s.v)} ${u}</div>`;
  }).join("");
  const ts = ticks(lo, hi, 5), d = tickDigits(ts);
  const sumTerms = steps.map((s) => `<span class="op">${s.v >= 0 ? "+" : "−"}</span>
    <span class="t ${s.v >= 0 ? "up" : "down"}">${fmt(Math.abs(s.v))}<small>${shortLabel(b, s.name)}</small></span>`).join("");
  const off = person ? ex.prediction - person.observed : 0;
  return `
    <div class="legend"><span><i style="border-color:var(--up)"></i>pushes up</span><span><i style="border-color:var(--down)"></i>pushes down</span>
      <span><i class="dash" style="border-color:var(--muted);border-top-width:1px"></i>starting point</span>
      ${person ? `<span><i class="dash" style="border-color:var(--good)"></i>measured value (${fmt(person.observed)} ${u})</span>` : ""}</div>
    <div class="wf">
      <div class="lbl"><b>Starting point</b><small>prediction for the training-average person</small></div>
      <div class="track">${guides}<div class="mark" style="left:${pos(ex.baseline)}%"></div></div>
      <div class="val">${fmt(ex.baseline)} ${u}</div>
      <div class="sep"></div>
      ${rows}
      <div class="sep"></div>
      <div class="lbl"><b>Prediction</b><small>starting point + all pushes</small></div>
      <div class="track">${guides}<div class="mark" style="left:${pos(ex.prediction)}%;background:var(--accent)"></div></div>
      <div class="val" style="color:var(--accent)">${fmt(ex.prediction)} ${u}</div>
      <div></div><div class="axis">${ts.map((t) => `<span style="left:${pos(t)}%">${fmt(t, d)}</span>`).join("")}</div><div class="axis note">${u}</div>
    </div>
    <p class="note" style="margin-bottom:0">The receipt, as arithmetic:</p>
    <div class="sum"><span class="t">${fmt(ex.baseline)}<small>starting point</small></span>${sumTerms}
      <span class="op">=</span><span class="t total" style="color:var(--accent)">${fmt(ex.prediction)} ${u}<small>prediction</small></span></div>
    ${top ? `<p><b>${shortLabel(b, top)}</b> pushes this prediction up the most (${signed(ex.groupedPushes[top])} ${u}): the longest orange bar, marked <span class="badge">biggest push up</span>.</p>`
      : `<p>No feature pushes this prediction up: every bar is blue.</p>`}
    ${person ? `<p class="note">Measured for this person: ${fmt(person.observed)} ${u}. The line's prediction is ${fmt(Math.abs(off))} ${u} ${off >= 0 ? "too high" : "too low"}.</p>` : ""}
    ${person && b.id === "fev1" && person.values.age < 18 ? `<div class="warn"><b>Where the straight line fails:</b> lungs grow through childhood and slowly shrink
      in adulthood, but a linear model gives every year of age the same push (${signed(b.linear.coefficients.age, 1)} ${u} per year). Fitted mostly to adults, that
      line predicts far too much for a child like this one. That's a limit of a straight line, not a bug.</div>` : ""}`;
}

function coefficientCard(b, ex, person, edited) {
  const u = b.units;
  const name = state.coefFeature;
  const g = b.categorical_groups.find((g) => g.name === name);
  const lin = b.linear;
  const options = Object.keys(ex.groupedPushes)
    .map((n) => `<option value="${n}" ${n === name ? "selected" : ""}>${shortLabel(b, n)}</option>`).join("");
  let coefText, pushText;
  if (!g) {
    const f = featureOf(b, name);
    const c = lin.coefficients[name], ref = lin.reference[name], x = state.values[name];
    coefText = `<p><b>Coefficient</b> (one number, the same for everyone): <span class="num">${signed(c, 3)} ${u} per 1 ${f.units === "years" ? "year" : f.units}</span> of
      ${f.label.split(" (")[0].toLowerCase()}, holding the other features fixed.</p>`;
    pushText = `<p><b>This person's push</b> (theirs only): coefficient × (their value − training average)</p>
      <div class="formula">${fmt(c, 3)} × (${fmt(x, 1)} − ${fmt(ref, 1)} ${f.units}) = <b>${signed(ex.groupedPushes[name], 1)} ${u}</b></div>`;
  } else {
    const cols = g.levels.filter((lv) => lv.column);
    coefText = `<p><b>Coefficient${cols.length > 1 ? "s" : ""}</b> (the same for everyone), each compared with the reference group, ${g.reference}:</p>
      <table>${cols.map((lv) => `<tr><td>${lv.label} vs ${g.reference}</td><td class="num">${signed(lin.coefficients[lv.column], 2)} ${u}</td></tr>`).join("")}</table>`;
    const terms = cols.map((lv) => `${fmt(lin.coefficients[lv.column], 2)} × (${state.values[lv.column]} − ${fmt(lin.reference[lv.column], 2)})`);
    pushText = `<p><b>This person's push</b> (theirs only): coefficient × (their 0/1 − share of the training people in that group).
      They are <b>${m10.categoryOf(b, name, state.values)}</b>.</p>
      <div class="formula">${terms.join(" + ")} = <b>${signed(ex.groupedPushes[name], 1)} ${u}</b></div>`;
  }
  const others = b.people.map((p) => ({ p, v: lin.people[p.id].grouped_pushes[name] }));
  return `<h3>3. A coefficient is not a push</h3>
    <label class="note">Feature: <select>${options}</select></label>
    ${coefText}${pushText}
    <p style="margin-top:12px">Same coefficient, different people, <b>different pushes</b>:</p>
    <table>${others.map(({ p, v }) => `<tr class="${p.id === person.id && !edited ? "current" : ""}"><td>${p.label} <span class="note">${featureDetail(b, name, p.values).split(" · ")[0]}</span></td>
      <td class="num ${v >= 0 ? "up" : "down"}">${signed(v)} ${u}</td></tr>`).join("")}</table>
    <p class="note">The coefficient describes the model. The push describes one person: it depends on how far they sit from the training average.</p>`;
}

function generalCard(b, ex) {
  const u = b.units;
  const t = b.linear.typical_effect_per_sd;
  const items = Object.entries(t).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1]));
  const m = Math.max(...items.map(([, v]) => Math.abs(v)));
  const top = biggestUp(ex.groupedPushes);
  const topGeneral = items[0][0];
  return `<h3>4. One person's biggest push ≠ most important feature overall</h3>
    <p>To compare features <i>in general</i>, multiply each coefficient by the feature's typical spread (one standard deviation in the
      training people), so every feature is in ${u}. Raw coefficients can't be compared because each feature has different units.</p>
    ${items.map(([n, v]) => `<div class="hbar"><span>${shortLabel(b, n)} <span class="note">(1 SD = ${fmt(b.feature_stats[n].train_sd, 1)} ${featureOf(b, n).units})</span></span>
      <div class="b"><span class="${v >= 0 ? "up" : "down"}" style="left:0;width:${(70 * Math.abs(v)) / m}%;background:var(--${v >= 0 ? "up" : "down"})"></span>
      <em style="left:calc(${(70 * Math.abs(v)) / m}% + 4px)">${signed(v)} ${u}</em></div></div>`).join("")}
    <p class="note">Typical effect = coefficient × 1 SD. Sex${b.categorical_groups.length > 1 ? " and race/ethnicity" : ""} are categories, so they
      are compared through their coefficients instead (card 3).</p>
    <p>${top && top !== topGeneral
      ? `For this person, <b>${shortLabel(b, top)}</b> pushes up the most, but across everyone <b>${shortLabel(b, topGeneral)}</b> has the largest typical effect.`
      : `Across everyone, <b>${shortLabel(b, topGeneral)}</b> has the largest typical effect. A person's own pushes can rank features differently because they depend on how unusual that person is.`}</p>`;
}

// ============================================================================
// Wisdom of the Forest: 100 jellybean-jar guessers, averaged
// ============================================================================
const CANDY = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f", "#12a594"];

function renderForest(b, person) {
  const u = b.units;
  const rf = b.forest;
  const pf = rf.people[person.id];
  const trees = pf.tree_predictions;
  const N = rf.n_trees;
  const avgUnique = sum(rf.bootstrap_unique_training_rows) / rf.bootstrap_unique_training_rows.length;
  const n = clamp(Number(state.nTrees || 10), 1, N);
  $("section").innerHTML = `
    <h2>Wisdom of the Forest <span class="tag">random forest</span></h2>
    <p class="takeaway">The forest asks ${N} slightly different trees and averages their guesses.</p>
    <div class="try"><b>Try this:</b> like a crowd guessing the jellybeans in a jar, each tree makes its own guess and the forest
      reports the average. Drag the slider to add guessers one at a time and watch the average settle down.
      Then pick <i>Fasting glucose → Example person 4</i>, where the trees disagree the most.</div>

    <div class="card">
      <h3>1. ${N} guesses for ${person.label} <span class="note">(${person.description})</span></h3>
      <label>Trees counted so far: <b id="ntrees-value">${n}</b> of ${N}
        <input id="ntrees" type="range" min="1" max="${N}" value="${n}" aria-label="Number of trees averaged"></label>
      <div class="stepper"><button data-n="1">1 tree</button><button data-n="5">5</button><button data-n="20">20</button><button data-n="${N}">All ${N}</button></div>
      <div id="forest-results"></div>
    </div>

    <div class="card">
      <h3>2. Why do the trees guess differently?</h3>
      <p>All ${N} trees use the same recipe, but two random choices make each one different, like guessers who each got a quick look at a
        different handful of jars:</p>
      <ul>
        <li><b>A different sample of people.</b> Each tree learns from ${rf.n_training_rows.toLocaleString()} people drawn at random
          <i>with replacement</i> from the training data, so some appear twice and others not at all. On average a tree sees only
          ${Math.round(avgUnique).toLocaleString()} different people (${Math.round((100 * avgUnique) / rf.n_training_rows)}%).</li>
        <li><b>A few clues at a time.</b> At each yes/no question, a tree may only choose from ${rf.features_tried_per_split} of the
          ${rf.n_features} features, picked at random, so trees end up asking different questions.</li>
      </ul>
      <p>Each tree's guess is the average outcome of the training people who landed in the same final group (leaf) as this person.
        Here are the first five trees and the path ${person.label} takes through each:</p>
      <div class="tree-cards">${pf.traced_trees.map((t, i) => treeCard(b, rf, t, i)).join("")}</div>
    </div>

    <div class="card">
      <h3>3. Disagreement between trees is not uncertainty</h3>
      <p>Each row shows one example person's ${N} tree guesses (ticks) and the forest's average (dot). Click a row to switch person.</p>
      <div class="people-rows" id="forest-people"></div>
      <div class="warn">
        <p style="margin-top:0"><b>The spread is <i>disagreement</i>, not a confidence or prediction interval.</b> The trees learned from
          overlapping samples of the same people, so they share blind spots. How much they disagree doesn't tell you how far the forest's
          average is from this person's true value. Check the measured values: sometimes they sit inside the spread, sometimes outside.</p>
        <p style="margin-bottom:0"><b>A forest can't predict beyond what it has seen.</b> Every guess is an average of training outcomes, so no
          prediction can go below ${fmt(rf.training_target_range[0])} or above ${fmt(rf.training_target_range[1])} ${u} (the lowest and
          highest outcomes in the training people).</p>
      </div>
    </div>

    <div class="card">
      <h3>4. More trees: steadier on average, across all validation people</h3>
      <div id="forest-val"></div>
    </div>`;

  $("forest-people").innerHTML = peopleSpread(b);
  $("forest-people").querySelectorAll(".pr").forEach((el) => (el.onclick = () => selectPerson(el.dataset.id)));
  const update = (k) => {
    $("ntrees-value").textContent = k;
    $("ntrees").value = k;
    $("forest-results").innerHTML = jar(b, person, trees, k);
    $("forest-val").innerHTML = validationByTrees(b, k);
  };
  $("ntrees").oninput = (e) => { state.nTrees = Number(e.target.value); update(state.nTrees); };
  document.querySelectorAll("[data-n]").forEach((el) => (el.onclick = () => { state.nTrees = Number(el.dataset.n); update(state.nTrees); }));
  update(n);
}

function treeCard(b, rf, t, i) {
  const u = b.units;
  const steps = t.steps;
  const shown = steps.length > 4 ? [...steps.slice(0, 3), null, steps[steps.length - 1]] : steps;
  return `<div class="tree-card"><b>Tree ${i + 1}</b>
    <span class="note">saw ${rf.bootstrap_unique_training_rows[i].toLocaleString()} different people</span>
    <ol>${shown.map((s) => s ? `<li>${question(b, s)}</li>` : `<li style="list-style:none">… ${steps.length - 4} more questions …</li>`).join("")}</ol>
    <span class="note">Guess:</span><b class="guess">${fmt(t.leaf_value)} ${u}</b></div>`;
}

// One yes/no question on the path, in words: 0/1 columns become a category answer.
function question(b, s) {
  const f = featureOf(b, s.feature);
  if (!f.binary) return `${shortLabel(b, s.feature)} ${s.goes} ${fmt(s.threshold, s.threshold < 10 ? 2 : 1)}`;
  if (s.feature === "female") return `Sex: ${s.goes === ">" ? "Female" : "Male"}`;
  return `${s.goes === ">" ? "Is" : "Not"} ${f.label.split(": ").pop().split(" (")[0]}`;
}

// The jar: one bean per tree, stacked by value; beans not yet counted are hollow.
function jar(b, person, trees, k) {
  const u = b.units;
  const N = trees.length;
  const partial = m10.runningAverage(trees, k);
  const full = b.forest.people[person.id].prediction;
  const vals = [...trees, person.observed, partial, full];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.05 || 1;
  lo -= pad; hi += pad;
  const W = chartW(), L = 10, R = 10, beanW = 13;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const cols = {};
  const beans = trees.map((t, i) => {
    const c = Math.round(x(t) / beanW);
    cols[c] = (cols[c] || 0) + 1;
    return { i, t, cx: c * beanW, level: cols[c] - 1 };
  });
  const maxStack = Math.max(...Object.values(cols));
  const beanH = 9, top = 30, base = top + maxStack * beanH + 6, H = base + 34;
  const y = (lvl) => base - 6 - lvl * beanH;
  const ts = ticks(lo, hi, 6), d = tickDigits(ts);
  const label = k < N ? `Partial forest (${k} of ${N} trees)` : `Whole forest (all ${N} trees)`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${N} tree guesses as jellybeans; ${label} average ${fmt(partial)} ${u}">
    <line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" stroke="var(--line)"/>
    ${ts.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${base}" y2="${base + 4}" stroke="var(--muted)"/><text x="${x(t)}" y="${base + 17}" text-anchor="middle">${fmt(t, d)}</text>`).join("")}
    <text x="${W - R}" y="${base + 31}" text-anchor="end">tree guess (${u})</text>
    ${beans.map((bn) => {
      const on = bn.i < k;
      return `<ellipse cx="${bn.cx}" cy="${y(bn.level)}" rx="6" ry="4.2" transform="rotate(-20 ${bn.cx} ${y(bn.level)})"
        fill="${on ? CANDY[bn.i % CANDY.length] : "none"}" stroke="${on ? "none" : "var(--muted)"}" stroke-width="0.8" opacity="${on ? 1 : 0.45}"><title>Tree ${bn.i + 1}: ${fmt(bn.t)} ${u}</title></ellipse>`;
    }).join("")}
    ${beans[0] ? `<circle cx="${beans[0].cx}" cy="${y(beans[0].level)}" r="8" fill="none" stroke="var(--fg)" stroke-width="1.5"/>` : ""}
    <line x1="${x(person.observed)}" x2="${x(person.observed)}" y1="${top - 8}" y2="${base}" stroke="var(--good)" stroke-width="2" stroke-dasharray="5 4"/>
    <line x1="${x(partial)}" x2="${x(partial)}" y1="${top - 14}" y2="${base}" stroke="var(--accent)" stroke-width="3"/>
    ${k < N ? `<line x1="${x(full)}" x2="${x(full)}" y1="${top - 4}" y2="${base}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.7"/>` : ""}
  </svg>`;
  const runs = trees.map((_, i) => m10.runningAverage(trees, i + 1));
  const lateDrift = Math.max(...runs.slice(49)) - Math.min(...runs.slice(49));
  return `
    <div class="legend"><span><i style="border-color:var(--accent)"></i>average of the trees counted</span>
      ${k < N ? `<span><i class="dash" style="border-color:var(--fg)"></i>whole-forest average</span>` : ""}
      <span><i class="dash" style="border-color:var(--good)"></i>measured value</span><span>◯ = tree 1</span><span>hollow bean = tree not counted yet</span></div>
    ${svg}
    <table>
      <tr><td><b>${label}</b>: average of the counted guesses</td><td class="num big" style="color:var(--accent)">${fmt(partial)} ${u}</td></tr>
      <tr><td>Forest prediction (average of all ${N} trees)</td><td class="num"><b>${fmt(full)} ${u}</b></td></tr>
      <tr><td>Tree 1 alone</td><td class="num">${fmt(trees[0])} ${u}</td></tr>
      <tr><td>Single trees range from</td><td class="num">${fmt(Math.min(...trees))} to ${fmt(Math.max(...trees))} ${u}</td></tr>
      <tr><td>Measured for this person</td><td class="num">${fmt(person.observed)} ${u}</td></tr>
    </table>
    ${runningChart(trees, k, full, u)}
    <p><b>Why the average is steadier than any one tree:</b> each tree's quirks push its guess too high or too low, but across ${N} trees those
      quirks point in different directions and partly cancel. Single trees for this person differ by up to
      ${fmt(Math.max(...trees) - Math.min(...trees))} ${u}, yet once 50 or more trees are counted the average only moves within
      ${fmt(lateDrift)} ${u}. Steadier doesn't mean correct: the average can still miss the measured value.</p>`;
}

function runningChart(trees, k, full, u) {
  const N = trees.length;
  const runs = trees.map((_, i) => m10.runningAverage(trees, i + 1));
  const W = chartW(), H = 170, L = 56, R = 12, T = 12, B = 34;
  let lo = Math.min(...runs, full), hi = Math.max(...runs, full);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x = (i) => L + ((i - 1) / (N - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = runs.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const yt = ticks(lo, hi, 4), d = tickDigits(yt);
  return `<p class="note" style="margin-bottom:0">Running average as trees are added, in their fixed order (this person):</p>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Running average of tree guesses by number of trees">
    ${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, d)}</text>`).join("")}
    <line x1="${L}" x2="${W - R}" y1="${y(full)}" y2="${y(full)}" stroke="var(--fg)" stroke-dasharray="2 3" opacity="0.7"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="${x(k)}" cy="${y(runs[k - 1])}" r="5" fill="var(--accent)"/>
    ${[1, 25, 50, 75, 100].filter((t) => t <= N).map((t) => `<text x="${x(t)}" y="${H - B + 16}" text-anchor="middle">${t}</text>`).join("")}
    <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">number of trees averaged</text>
    <text x="12" y="${T + (H - T - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${T + (H - T - B) / 2})">average (${u})</text>
  </svg>`;
}

function peopleSpread(b) {
  const u = b.units;
  const rf = b.forest;
  const all = b.people.flatMap((p) => [...rf.people[p.id].tree_predictions, p.observed]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const W = Math.round(chartW() * 0.66), H = 36;
  const x = (v) => 6 + ((v - lo) / (hi - lo)) * (W - 12);
  const rows = b.people.map((p) => {
    const tp = rf.people[p.id].tree_predictions;
    const mean = rf.people[p.id].prediction;
    const sd = Math.sqrt(sum(tp.map((t) => (t - mean) ** 2)) / tp.length);
    return `<div class="pr ${p.id === state.person ? "current" : ""}" data-id="${p.id}" role="button" tabindex="0">
      <div class="lbl"><b>${p.label}</b><small>${p.description} · ${p.why_chosen}</small><small>tree spread (SD): ${fmt(sd)} ${u}</small></div>
      <svg viewBox="0 0 ${W} ${H}" aria-label="${p.label}: tree guesses from ${fmt(Math.min(...tp))} to ${fmt(Math.max(...tp))} ${u}">
        <line x1="${x(Math.min(...tp))}" x2="${x(Math.max(...tp))}" y1="18" y2="18" stroke="var(--line)" stroke-width="8" stroke-linecap="round"/>
        ${tp.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="12" y2="24" stroke="var(--accent)" stroke-width="1" opacity="0.45"/>`).join("")}
        <line x1="${x(p.observed)}" x2="${x(p.observed)}" y1="5" y2="31" stroke="var(--good)" stroke-width="2" stroke-dasharray="3 3"/>
        <circle cx="${x(mean)}" cy="18" r="5" fill="var(--fg)"/>
      </svg></div>`;
  });
  const ts = ticks(lo, hi, 5), d = tickDigits(ts);
  return `${rows.join("")}
    <div class="pr" style="cursor:default"><div></div><svg viewBox="0 0 ${W} 18">${ts.map((t) => `<text x="${x(t)}" y="13" text-anchor="middle">${fmt(t, d)}</text>`).join("")}</svg></div>
    <div class="legend"><span>| tree guess</span><span>● forest average</span><span><i class="dash" style="border-color:var(--good)"></i>measured value</span><span>all in ${u}</span></div>`;
}

function validationByTrees(b, k) {
  const u = b.units;
  const v = b.forest.validation_rmse_by_trees;
  const N = v.length;
  const W = chartW(), H = 180, L = 56, R = 12, T = 12, B = 34;
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x = (i) => L + ((i - 1) / (N - 1)) * (W - L - R);
  const y = (val) => T + (1 - (val - lo) / (hi - lo)) * (H - T - B);
  const yt = ticks(lo, hi, 4), d = tickDigits(yt);
  return `<p>This chart uses all ${b.n_validation.toLocaleString()} validation people (not used for training). Typical error (RMSE) of a
      <b>partial forest</b> made of the first <i>k</i> trees: one tree alone is off by ${fmt(v[0])} ${u}; all ${N} trees together, ${fmt(v[N - 1])} ${u}.
      Your slider: ${k} tree${k > 1 ? "s" : ""} → ${fmt(v[k - 1])} ${u}.</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Validation RMSE by number of trees">
      ${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, d)}</text>`).join("")}
      <path d="${v.map((val, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(val).toFixed(1)}`).join("")}" fill="none" stroke="var(--up)" stroke-width="2"/>
      <circle cx="${x(k)}" cy="${y(v[k - 1])}" r="5" fill="var(--up)"/>
      ${[1, 25, 50, 75, 100].filter((t) => t <= N).map((t) => `<text x="${x(t)}" y="${H - B + 16}" text-anchor="middle">${t}</text>`).join("")}
      <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">number of trees averaged</text>
      <text x="12" y="${T + (H - T - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${T + (H - T - B) / 2})">validation RMSE (${u})</text>
    </svg>
    <p class="note">Error on new people drops quickly and then levels off: after a few dozen trees, extra trees mostly make the average steadier.
      This is the error across many people. It isn't a range for any one person's prediction.</p>`;
}

// ============================================================================
// One Correction at a Time (gradient boosting): a sculptor chipping toward the shape
// ============================================================================
function renderBoosting(b, person) {
  const u = b.units;
  const gb = b.boosting;
  const p = gb.people[person.id];
  const M = p.corrections.length;
  const best = gb.best_validation_round;
  const r = clamp(Number(state.round ?? 1), 0, M);
  $("section").innerHTML = `
    <h2>One Correction at a Time <span class="tag">gradient boosting</span></h2>
    <p class="takeaway">Boosting starts at the average. Each small tree fixes part of the remaining error, until more trees stop
      helping on new people.</p>
    <div class="try"><b>Try this:</b> think of a sculptor. Round 0 is a rough block (the same guess for everyone: the training average).
      Each round chips off a small piece of what's still wrong. Step through the rounds, then <b>choose where to stop</b> using the
      validation error in step 3. Can you explain your choice?</div>

    <div class="card">
      <h3>1. Chip by chip: ${person.label} <span class="note">(${person.description}, measured ${fmt(person.observed)} ${u})</span></h3>
      <label>Stop after round <b id="round-value">${r}</b> of ${M}
        <input id="round" type="range" min="0" max="${M}" value="${r}" aria-label="Boosting round"></label>
      <div class="stepper">
        <button data-step="-1" aria-label="Previous round">◀ Previous</button><button data-step="1" class="primary" aria-label="Next round">Next round ▶</button>
        <span class="note">Jump to:</span>
        <button data-r="0">Round 0</button><button data-r="1">1</button><button data-r="10">10</button>
        <button data-r="${best}">${best} (lowest validation error)</button><button data-r="100">100</button><button data-r="${M}">${M}</button>
      </div>
      <div id="boost-step"></div>
      <div id="boost-track"></div>
    </div>

    <div class="card">
      <h3>2. What is each chip?</h3>
      <p>Each round fits a small tree (at most ${gb.settings && gb.settings.max_depth ? gb.settings.max_depth : 3} yes/no questions deep) to the
        <b>training residuals</b>: for every training person, how far the current prediction still is from their measured value. The tree's
        answer is shrunk by the learning rate (${gb.learning_rate}) and added on, so each chip is small and many rounds are needed.
        The corrections shown here already include that shrinking.</p>
      <div id="boost-chips"></div>
    </div>

    <div class="card">
      <h3>3. When should the sculptor stop?</h3>
      <p>Training error keeps falling because later chips start carving the noise in the training people. To choose a stopping round,
        check the error on the <b>validation people</b>, who weren't used for fitting.</p>
      <div id="boost-error"></div>
      <div id="boost-verdict"></div>
      <div class="stepper"><button data-r="${M}">Stop where training error is lowest (round ${M})</button>
        <button data-r="${best}" class="primary">Stop where validation error is lowest (round ${best})</button></div>
      <p class="note">Because the validation people were used to <i>make</i> this choice, their error isn't an independent test result.
        A fair final check would need people who weren't used for either fitting or choosing.</p>
    </div>`;

  const update = (k) => {
    state.round = k;
    $("round-value").textContent = k;
    $("round").value = k;
    $("boost-step").innerHTML = stepEquation(b, p, k);
    $("boost-track").innerHTML = trackChart(b, p, person, k);
    $("boost-chips").innerHTML = chipsChart(b, p, person, k);
    $("boost-error").innerHTML = errorChart(b, k);
    $("boost-verdict").innerHTML = verdict(b, k);
  };
  $("round").oninput = (e) => update(Number(e.target.value));
  document.querySelectorAll("[data-step]").forEach((el) => (el.onclick = () => update(clamp(state.round + Number(el.dataset.step), 0, M))));
  document.querySelectorAll("[data-r]").forEach((el) => (el.onclick = () => update(Number(el.dataset.r))));
  update(r);
}

function stepEquation(b, p, k) {
  const u = b.units;
  if (k === 0) {
    return `<div class="step-eq"><div class="box"><small>Round 0: the rough block</small><b>${fmt(b.boosting.init)} ${u}</b></div></div>
      <p class="note">Round 0 is the average outcome of the training people. Everyone starts here, before any tree has looked at their features.</p>`;
  }
  const c = p.corrections[k - 1];
  return `<div class="step-eq">
      <div class="box"><small>after round ${k - 1}</small><b>${fmt(p.staged[k - 1])}</b></div>
      <span class="op">${c >= 0 ? "+" : "−"}</span>
      <div class="box"><small>tree ${k}'s chip</small><b class="${c >= 0 ? "up" : "down"}">${fmt(Math.abs(c), 2)}</b></div>
      <span class="op">=</span>
      <div class="box" style="border-color:var(--accent)"><small>after round ${k}</small><b style="color:var(--accent)">${fmt(p.staged[k])} ${u}</b></div>
    </div>`;
}

// Log-like round axis so the early rounds, where most of the change happens, get room.
const roundX = (m, M, L, W) => L + (Math.log10(1 + m) / Math.log10(1 + M)) * W;
const ROUND_TICKS = [0, 1, 5, 20, 100, 500];

function roundAxis(M, L, plotW, base, H) {
  return `${ROUND_TICKS.filter((t) => t <= M).map((t) => `<line x1="${roundX(t, M, L, plotW)}" x2="${roundX(t, M, L, plotW)}" y1="${base}" y2="${base + 4}" stroke="var(--muted)"/>
    <text x="${roundX(t, M, L, plotW)}" y="${base + 16}" text-anchor="middle">${t}</text>`).join("")}
    <text x="${L + plotW / 2}" y="${H - 3}" text-anchor="middle">round (stretched so early rounds are visible)</text>`;
}

function trackChart(b, p, person, k) {
  const u = b.units;
  const M = p.corrections.length;
  const W = chartW(), H = 200, L = 60, R = 12, T = 14, B = 34, plotW = W - L - R;
  let lo = Math.min(...p.staged, person.observed), hi = Math.max(...p.staged, person.observed);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const x = (m) => roundX(m, M, L, plotW);
  const path = (to) => p.staged.slice(0, to + 1).map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const yt = ticks(lo, hi, 4), d = tickDigits(yt);
  return `<div class="legend"><span><i style="border-color:var(--accent)"></i>prediction so far</span><span><i style="border-color:var(--line)"></i>rounds still to come</span>
      <span><i class="dash" style="border-color:var(--good)"></i>measured value (${fmt(person.observed)} ${u})</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="This person's prediction after each round">
      ${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" opacity="0.6"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, d)}</text>`).join("")}
      <line x1="${L}" x2="${W - R}" y1="${y(person.observed)}" y2="${y(person.observed)}" stroke="var(--good)" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${path(M)}" fill="none" stroke="var(--line)" stroke-width="2"/>
      <path d="${path(k)}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
      <circle cx="${x(k)}" cy="${y(p.staged[k])}" r="5" fill="var(--accent)"/>
      ${roundAxis(M, L, plotW, H - B, H)}
      <text x="12" y="${T + (H - T - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${T + (H - T - B) / 2})">prediction (${u})</text>
    </svg>`;
}

function chipsChart(b, p, person, k) {
  const u = b.units;
  const M = p.corrections.length;
  const W = chartW(), H = 170, L = 60, R = 12, T = 10, B = 34, plotW = W - L - R;
  const m = Math.max(...p.corrections.map(Math.abs)) || 1;
  const mid = T + (H - T - B) / 2, half = (H - T - B) / 2;
  const x = (r) => roundX(r, M, L, plotW);
  let wrong = 0;
  for (let i = 0; i < k; i++) if (Math.sign(p.corrections[i]) !== Math.sign(person.observed - p.staged[i]) && p.corrections[i] !== 0) wrong++;
  const bars = p.corrections.map((c, i) => {
    const r = i + 1, h = (Math.abs(c) / m) * half;
    return `<line x1="${x(r)}" x2="${x(r)}" y1="${mid}" y2="${c >= 0 ? mid - h : mid + h}" stroke="var(--${c >= 0 ? "up" : "down"})"
      stroke-width="${r === k ? 4 : 1.5}" opacity="${r <= k ? 1 : 0.2}"/>`;
  }).join("");
  return `<p class="note" style="margin-bottom:0">This person's chip from every round (orange = up, blue = down; faded = not reached yet):</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Correction added in each round">
      <line x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>
      <text x="${L - 6}" y="${mid - half + 10}" text-anchor="end">${signed(m, m < 10 ? 1 : 0)}</text>
      <text x="${L - 6}" y="${mid + 4}" text-anchor="end">0</text>
      <text x="${L - 6}" y="${mid + half}" text-anchor="end">${signed(-m, m < 10 ? 1 : 0)}</text>
      ${bars}
      ${roundAxis(M, L, plotW, H - B, H)}
      <text x="12" y="${mid}" text-anchor="middle" transform="rotate(-90 12 ${mid})">chip (${u})</text>
    </svg>
    <p>The first chips are the biggest; later ones get tiny. Not every chip helps this person: in rounds 1–${k || 0},
      <b>${wrong} of ${k}</b> chips moved ${person.label} <i>away</i> from their measured value. Each tree fixes the training error
      across everyone, not every person every round.</p>`;
}

function errorChart(b, k) {
  const u = b.units;
  const gb = b.boosting;
  const tr = gb.rmse.train, va = gb.rmse.validation;
  const M = tr.length - 1, best = gb.best_validation_round;
  const W = chartW(), H = 230, L = 60, R = 12, T = 14, B = 34, plotW = W - L - R;
  let lo = Math.min(...tr, ...va), hi = Math.max(...tr, ...va);
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const x = (m) => roundX(m, M, L, plotW);
  const line = (arr) => arr.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const yt = ticks(lo, hi, 5), d = tickDigits(yt);
  return `<div class="legend"><span><i style="border-color:var(--muted)"></i>training error (people the trees were fitted to)</span>
      <span><i style="border-color:var(--up)"></i>validation error (new people)</span><span>● lowest validation error</span>
      <span><i class="dash" style="border-color:var(--accent)"></i>your stopping round</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Training and validation RMSE by round">
      ${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" opacity="0.6"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, d)}</text>`).join("")}
      <path d="${line(tr)}" fill="none" stroke="var(--muted)" stroke-width="2"/>
      <path d="${line(va)}" fill="none" stroke="var(--up)" stroke-width="2.5"/>
      <line x1="${x(k)}" x2="${x(k)}" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/>
      <circle cx="${x(best)}" cy="${y(gb.best_validation_rmse)}" r="6" fill="var(--up)" stroke="var(--bg)" stroke-width="2"/>
      <text x="${x(best)}" y="${y(gb.best_validation_rmse) - 10}" text-anchor="middle" style="fill:var(--up);font-weight:700">round ${best}</text>
      ${roundAxis(M, L, plotW, H - B, H)}
      <text x="12" y="${T + (H - T - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${T + (H - T - B) / 2})">RMSE (${u})</text>
    </svg>`;
}

function verdict(b, k) {
  const u = b.units;
  const gb = b.boosting;
  const best = gb.best_validation_round, bestV = gb.best_validation_rmse;
  const v = gb.rmse.validation[k], t = gb.rmse.train[k];
  const gap = v - bestV;
  let cls, text;
  if (k === best) {
    cls = "good";
    text = `This is the round with the lowest validation error. It's a good, validation-based place to stop.`;
  } else if (k < best) {
    cls = gap > 0.02 * bestV ? "bad" : "good";
    text = `Stopping early: the block is still rough. More chips would still lower the error on new people (by ${fmt(gap, 2)} ${u} if you went on to round ${best}).`;
  } else {
    cls = gap > 0.02 * bestV ? "bad" : "good";
    text = `Past round ${best}, training error keeps falling (now ${fmt(t)} ${u}), but validation error has risen by ${fmt(gap, 2)} ${u}.
      The extra chips are carving noise in the training people (overfitting), not shape that carries over to new people.`;
  }
  return `<div class="verdict ${cls}">
    <p style="margin:0 0 6px"><b>If you stop after round ${k}:</b> validation RMSE <b>${fmt(v)} ${u}</b>, training RMSE ${fmt(t)} ${u}.
      Lowest validation RMSE: <b>${fmt(bestV)} ${u} at round ${best}</b>.</p>
    <p style="margin:0">${text}</p></div>
    <p class="note">Training error is lowest at the very last round (${fmt(gb.rmse.train[gb.rmse.train.length - 1])} ${u} at round ${gb.rmse.train.length - 1}),
      so choosing by training error would always pick the most over-carved model. Rounds near ${best} have almost the same validation error,
      so any of them is a reasonable choice.</p>`;
}

setup();
