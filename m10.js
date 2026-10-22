// Helpers for the M10 "Explain the Model" starter (browser version of m10.py).
// You don't have to read this file.
//
//   import * as m10 from "./m10.js";
//   const bundle = await m10.loadBundle("glucose");
//   m10.linearExplain(bundle, values);          // baseline + pushes = prediction
//   await m10.boostingRounds("glucose", values) // round-by-round predictions

export const DATASETS = ["glucose", "sbp", "fev1"];

const cache = {};
async function loadJson(path) {
  if (!cache[path]) cache[path] = fetch(path).then((r) => r.json());
  return cache[path];
}

export const loadBundle = (key) => loadJson(`outputs/${key}.json`);
export const loadBoostingTrees = (key) => loadJson(`outputs/${key}_boosting_trees.json`);
export const featureNames = (bundle) => bundle.features.map((f) => f.name);

// ---- Linear: push_j = coefficient_j × (x_j − reference_j); baseline + Σ pushes = prediction
export function linearExplain(bundle, x) {
  const lin = bundle.linear;
  const pushes = {};
  for (const f of featureNames(bundle)) pushes[f] = lin.coefficients[f] * (x[f] - lin.reference[f]);
  const total = Object.values(pushes).reduce((a, b) => a + b, 0);
  return { baseline: lin.baseline, pushes, groupedPushes: groupPushes(bundle, pushes), prediction: lin.baseline + total };
}

// Combine 0/1 indicator columns into one push per category (sex, ethnicity).
export function groupPushes(bundle, pushes) {
  const out = {};
  const used = new Set();
  for (const g of bundle.categorical_groups) {
    const cols = g.levels.filter((lv) => lv.column).map((lv) => lv.column);
    out[g.name] = cols.reduce((s, c) => s + pushes[c], 0);
    cols.forEach((c) => used.add(c));
  }
  for (const [f, v] of Object.entries(pushes)) if (!used.has(f)) out[f] = v;
  return out;
}

// 0/1 column values for one category choice, e.g. ("ethnicity", "Non-Hispanic Black").
export function categoryInputs(bundle, group, level) {
  const g = bundle.categorical_groups.find((g) => g.name === group);
  const out = {};
  for (const lv of g.levels) if (lv.column) out[lv.column] = lv.label === level ? 1 : 0;
  return out;
}

// The category a person belongs to, e.g. "Female".
export function categoryOf(bundle, group, values) {
  const g = bundle.categorical_groups.find((g) => g.name === group);
  const hit = g.levels.find((lv) => lv.column && values[lv.column] === 1);
  return hit ? hit.label : g.reference;
}

// ---- Forest: the prediction is the average of the trees
export function runningAverage(treePredictions, nTrees) {
  const used = treePredictions.slice(0, nTrees);
  return used.reduce((a, b) => a + b, 0) / used.length;
}

// ---- Boosting: staged[0] = training mean; staged[m] = staged[m-1] + corrections[m-1]
// (each correction already includes the learning rate, applied once)
function treeValue(tree, x32) {
  let node = 0;
  while (tree.left[node] !== -1) {
    node = x32[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

export async function boostingRounds(key, x) {
  const t = await loadBoostingTrees(key);
  const x32 = t.feature_order.map((f) => Math.fround(x[f])); // scikit-learn compares in float32
  const corrections = t.trees.map((tree) => t.learning_rate * treeValue(tree, x32));
  const staged = [t.init];
  for (const c of corrections) staged.push(staged[staged.length - 1] + c);
  return { staged, corrections };
}
