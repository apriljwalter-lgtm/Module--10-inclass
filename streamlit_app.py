"""Starter app for Streamlit Community Cloud: three plain sections that show the right numbers.

Run locally:  uv run --with streamlit,pandas,numpy streamlit run streamlit_app.py
Replace each section's display with your own explainer; keep the numbers.
"""

import pandas as pd
import streamlit as st

import m10

LABELS = {"glucose": "Fasting glucose", "sbp": "Blood pressure", "fev1": "Lung function (FEV₁)"}


def signed(v: float, d: int = 1) -> str:
    return f"{v:+.{d}f}"


def pick_person() -> tuple[dict, dict]:
    key = st.sidebar.selectbox("Dataset", m10.DATASETS, format_func=LABELS.get, key="dataset")
    b = m10.load_bundle(key)
    labels = {p["id"]: f"{p['label']}: {p['description']}" for p in b["people"]}
    pid = st.sidebar.selectbox("Example person", list(labels), format_func=labels.get, key=f"person_{key}")
    return b, next(p for p in b["people"] if p["id"] == pid)


def starter_note(text: str) -> None:
    st.info(f"Starter display: {text} Replace it with your own explainer.")


def label_of(b: dict, name: str) -> str:
    return next((f["label"] for f in b["features"] if f["name"] == name), name)


# ---- Push & Pull -------------------------------------------------------------
def linear_page() -> None:
    b, person = pick_person()
    u = b["units"]
    st.header("Push & Pull: which features push the prediction up or down?")
    starter_note("a plain table of pushes.")

    values = dict(person["values"])
    groups = b["categorical_groups"]
    grouped = {lv["column"] for g in groups for lv in g["levels"] if lv["column"]}
    cols = st.columns(3)
    numeric = [f for f in b["features"] if f["name"] not in grouped]
    for i, f in enumerate(numeric):
        s = b["feature_stats"][f["name"]]
        values[f["name"]] = cols[i % 3].number_input(
            f"{f['label']} ({f['units']})", min_value=float(s["min"]), max_value=float(s["max"]),
            value=float(values[f["name"]]),
            key=f"{b['id']}_{person['id']}_{f['name']}")
    for j, g in enumerate(groups):
        levels = [lv["label"] for lv in g["levels"]]
        current = next((lv["label"] for lv in g["levels"] if lv["column"] and values[lv["column"]] == 1), g["reference"])
        choice = cols[(len(numeric) + j) % 3].selectbox(g["label"], levels, index=levels.index(current),
                                                        key=f"{b['id']}_{person['id']}_{g['name']}")
        values.update({lv["column"]: float(lv["label"] == choice) for lv in g["levels"] if lv["column"]})

    ex = m10.linear_explain(b, values)
    group_names = {g["name"]: g["label"] for g in groups}
    rows = [("Starting point (prediction for the training average)", f"{ex['baseline']:.1f} {u}")]
    rows += [(group_names.get(k, label_of(b, k)), f"{signed(v)} {u}") for k, v in ex["grouped_pushes"].items()]
    rows += [("Prediction", f"{ex['prediction']:.1f} {u}")]
    st.table(pd.DataFrame(rows, columns=["", "Value"]).set_index(""))
    st.caption("Each push = coefficient × (this value − training average). Starting point + all pushes = prediction. "
               f"Categories are compared with the training mix; the model's reference group is "
               f"{' / '.join(g['reference'] for g in groups)}. These are associations in the data, not causes.")


# ---- Wisdom of the Forest ----------------------------------------------------
def forest_page() -> None:
    b, person = pick_person()
    u, rf = b["units"], b["forest"]
    trees = rf["people"][person["id"]]["tree_predictions"]
    st.header(f"Wisdom of the Forest: how do {rf['n_trees']} trees combine?")
    starter_note("a list of tree guesses and their average.")
    st.write(f"{person['label']} ({person['description']}). Observed: {person['observed']:.1f} {u}.")
    st.write("First 10 trees' guesses: " + ", ".join(f"{t:.1f}" for t in trees[:10]) + f" {u}")

    n = st.slider("Trees included", 1, rf["n_trees"], 10)
    partial = sum(trees[:n]) / n
    name = (f"Partial forest: average of the first {n} of {rf['n_trees']} trees" if n < rf["n_trees"]
            else f"Whole forest: average of all {rf['n_trees']} trees")
    st.table(pd.DataFrame([
        (name, f"{partial:.1f} {u}"),
        (f"Forest prediction (all {rf['n_trees']} trees)", f"{rf['people'][person['id']]['prediction']:.1f} {u}"),
        ("Tree disagreement for this person (lowest to highest guess)", f"{min(trees):.1f} to {max(trees):.1f} {u}"),
    ], columns=["", "Value"]).set_index(""))
    share = sum(rf["bootstrap_unique_training_rows"]) / len(rf["bootstrap_unique_training_rows"]) / rf["n_training_rows"]
    st.caption(f"Trees differ because each one learns from a different bootstrap sample (about {share:.0%} of the "
               f"training people, some repeated) and tries only {rf['features_tried_per_split']} of {rf['n_features']} "
               "features at each split. The spread is disagreement between trees, not a confidence interval.")


# ---- One Correction at a Time -----------------------------------------------
def boosting_page() -> None:
    b, person = pick_person()
    u, gb = b["units"], b["boosting"]
    p = gb["people"][person["id"]]
    st.header("One Correction at a Time: how does each tree improve the model?")
    starter_note("a slider, three numbers and a plain error chart.")
    st.write(f"{person['label']} ({person['description']}). Observed: {person['observed']:.1f} {u}.")

    r = st.slider("Round", 0, len(p["corrections"]), 1)
    if r == 0:
        rows = [("Round 0: average outcome in the training rows", f"{gb['init']:.1f} {u}")]
    else:
        rows = [(f"Prediction after round {r - 1}", f"{p['staged'][r - 1]:.1f} {u}"),
                (f"Correction from tree {r} (already scaled by the learning rate)",
                 f"{signed(p['corrections'][r - 1], 2)} {u}"),
                (f"Prediction after round {r}", f"{p['staged'][r]:.1f} {u}")]
    st.table(pd.DataFrame(rows, columns=["", "Value"]).set_index(""))

    curve = pd.DataFrame({"Training RMSE": gb["rmse"]["train"], "Validation RMSE": gb["rmse"]["validation"]})
    curve.index.name = "Round"
    st.line_chart(curve, x_label="Round", y_label=f"RMSE ({u})")
    st.write(f"If you stop at round {r}: validation RMSE {gb['rmse']['validation'][r]:.1f} {u} "
             f"(training {gb['rmse']['train'][r]:.1f} {u}). Lowest validation RMSE: "
             f"{gb['best_validation_rmse']:.1f} {u} at round {gb['best_validation_round']}.")
    st.caption("Each new tree is fitted to the training errors (residuals) left by the rounds before it. "
               "The stopping round is chosen with validation data, so its error is not an independent test result.")


st.set_page_config(page_title="Explain the Model")
st.navigation([
    st.Page(linear_page, title="Push & Pull", url_path="linear", default=True),
    st.Page(forest_page, title="Wisdom of the Forest", url_path="forest"),
    st.Page(boosting_page, title="One Correction at a Time", url_path="boosting"),
]).run()
