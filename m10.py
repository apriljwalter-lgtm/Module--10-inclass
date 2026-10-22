"""Helpers for the M10 "Explain the Model" starter.

You don't have to read this file. It loads the data and the reference model
outputs, and it holds the three fixed models so every entry explains the same thing.

    import m10
    bundle = m10.load_bundle("glucose")          # all the numbers your app needs
    m10.linear_explain(bundle, {"age": 50, ...}) # live linear prediction for custom inputs

Datasets: "glucose", "sbp", "fev1".
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
DATA = HERE / "data"
OUTPUTS = HERE / "outputs"
DATASETS = ["glucose", "sbp", "fev1"]

# The fixed models. Do not change these: everyone explains the same models.
LINEAR = {}
FOREST = {"n_estimators": 100, "max_features": "sqrt", "bootstrap": True, "random_state": 0}
BOOSTING = {"loss": "squared_error", "n_estimators": 500, "learning_rate": 0.1,
            "max_depth": 3, "random_state": 0}


@lru_cache(maxsize=None)
def load_bundle(key: str) -> dict:
    """Reference outputs for one dataset (see outputs/SCHEMA.md)."""
    return json.loads((OUTPUTS / f"{key}.json").read_text())


@lru_cache(maxsize=None)
def load_boosting_trees(key: str) -> dict:
    """The 500 small boosting trees, for live predictions on custom inputs."""
    return json.loads((OUTPUTS / f"{key}_boosting_trees.json").read_text())


def load_data(key: str):
    """The dataset as a DataFrame (row_id, split, features, target)."""
    import pandas as pd

    return pd.read_csv(DATA / f"{key}.csv")


def feature_names(bundle: dict) -> list[str]:
    return [f["name"] for f in bundle["features"]]


# ---- Linear: baseline + pushes = prediction --------------------------------

def linear_explain(bundle: dict, x: dict) -> dict:
    """Prediction for any inputs, split into a baseline and one push per feature.

    push_j = coefficient_j × (x_j − reference_j), with the reference at the
    training means. baseline + sum(pushes) = prediction.
    """
    lin = bundle["linear"]
    pushes = {f: lin["coefficients"][f] * (x[f] - lin["reference"][f]) for f in feature_names(bundle)}
    grouped = group_pushes(bundle, pushes)
    return {"baseline": lin["baseline"], "pushes": pushes, "grouped_pushes": grouped,
            "prediction": lin["baseline"] + sum(pushes.values())}


def group_pushes(bundle: dict, pushes: dict) -> dict:
    """Combine 0/1 indicator columns into one push per category (sex, ethnicity)."""
    out, used = {}, set()
    for g in bundle["categorical_groups"]:
        cols = [lv["column"] for lv in g["levels"] if lv["column"]]
        out[g["name"]] = sum(pushes[c] for c in cols)
        used.update(cols)
    for f, v in pushes.items():
        if f not in used:
            out[f] = v
    return out


def category_inputs(bundle: dict, group: str, level: str) -> dict:
    """0/1 column values for one category choice, e.g. ("ethnicity", "Non-Hispanic Black")."""
    g = next(g for g in bundle["categorical_groups"] if g["name"] == group)
    return {lv["column"]: float(lv["label"] == level) for lv in g["levels"] if lv["column"]}


# ---- Boosting: each round adds one scaled correction -----------------------

def _tree_value(tree: dict, x32: np.ndarray) -> float:
    node = 0
    while tree["left"][node] != -1:
        go_left = x32[tree["feature"][node]] <= tree["threshold"][node]
        node = tree["left"][node] if go_left else tree["right"][node]
    return tree["value"][node]


def boosting_rounds(key: str, x: dict) -> dict:
    """Round-by-round boosting predictions for any inputs.

    staged[0] is the training mean; staged[m] = staged[m-1] + corrections[m-1],
    where each correction already includes the learning rate (applied once).
    """
    trees = load_boosting_trees(key)
    # like scikit-learn: round inputs to float32, then compare with the float64 thresholds
    x32 = np.array([x[f] for f in trees["feature_order"]], dtype=np.float32).astype(np.float64)
    corrections = [trees["learning_rate"] * _tree_value(t, x32) for t in trees["trees"]]
    staged = np.concatenate([[trees["init"]], trees["init"] + np.cumsum(corrections)])
    return {"staged": staged.tolist(), "corrections": corrections}


# ---- Refitting (optional: only for live forest predictions on custom inputs) ----

def make_models(learning_rate: float = 0.1):
    from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import LinearRegression

    return {
        "linear": LinearRegression(**LINEAR),
        "forest": RandomForestRegressor(**FOREST),
        "boosting": GradientBoostingRegressor(**(BOOSTING | {"learning_rate": learning_rate})),
    }


def fit_models(key: str, learning_rate: float = 0.1) -> dict:
    """Fit the fixed models on the training rows. Check them against the bundle with
    check_refit() before trusting them: a different scikit-learn version can change the forest."""
    df = load_data(key)
    bundle = load_bundle(key)
    train = df[df.split == "train"]
    X, y = train[feature_names(bundle)].to_numpy(float), train[bundle["target"]].to_numpy(float)
    models = make_models(learning_rate)
    for m in models.values():
        m.fit(X, y)
    return models


def forest_tree_predictions(forest, bundle: dict, x: dict) -> list[float]:
    row = np.array([[x[f] for f in feature_names(bundle)]], dtype=float)
    return [float(t.predict(row)[0]) for t in forest.estimators_]


def check_refit(models: dict, bundle: dict, tol: float = 1e-3) -> bool:
    """True if the refitted models reproduce the reference predictions."""
    ok = True
    for p in bundle["people"]:
        row = np.array([[p["values"][f] for f in feature_names(bundle)]], dtype=float)
        ok &= abs(models["linear"].predict(row)[0] - bundle["linear"]["people"][p["id"]]["prediction"]) < tol
        ok &= abs(models["forest"].predict(row)[0] - bundle["forest"]["people"][p["id"]]["prediction"]) < tol
        ok &= abs(models["boosting"].predict(row)[0] - bundle["boosting"]["people"][p["id"]]["staged"][-1]) < tol
    return bool(ok)
