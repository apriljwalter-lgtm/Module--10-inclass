# What's in `outputs/<key>.json`

`<key>` is `glucose`, `sbp` or `fev1`. All models were fitted on the **train** rows only. RMSE is in the target's units.

## Top level
| Field | Meaning |
|---|---|
| `name`, `target`, `target_label`, `units` | Dataset name, target column, readable label, units |
| `features[]` | `{name, label, units, binary}` in model order |
| `categorical_groups[]` | `sex` (and `ethnicity` for sbp): `{name, label, levels[{label, column}], reference}`. A level with `column: null` is the reference group. |
| `feature_stats.<f>` | Training `train_mean`, `train_sd`, `min`, `max`, `p01`, `p99` |
| `people[]` | 5 validation people: `{id, label, description, why_chosen, row_id, split, values{feature: value}, observed}`. The same people appear in every student's app. |
| `n_train`, `n_validation`, `split_description` | The fixed 80/20 split |

## `linear` (LinearRegression, natural units)
| Field | Meaning |
|---|---|
| `coefficients.<f>` | Change in prediction per 1 unit of `f`, holding the others fixed |
| `reference.<f>` | Training average of `f` (the comparison point for pushes) |
| `baseline` | **Starting point:** the prediction at the reference. This is not the intercept. |
| `intercept` | Prediction when every feature is 0 (usually meaningless; don't display it as the starting point) |
| `typical_effect_per_sd.<f>` | coefficient × training SD, for numeric features: a fair "in general" comparison |
| `people.<id>.pushes` / `.grouped_pushes` | coefficient × (value − reference) per column / with 0/1 columns combined per category |
| `people.<id>.prediction` | `baseline` + sum of pushes |

## `forest` (RandomForestRegressor: 100 trees, max_features="sqrt", bootstrap)
| Field | Meaning |
|---|---|
| `people.<id>.tree_predictions` | All 100 tree guesses, in the fixed tree order |
| `people.<id>.prediction` | Their average = the forest's prediction |
| `people.<id>.traced_trees` | Trees 1–5: the path of yes/no questions (`steps[{feature, threshold, goes}]`) and `leaf_value` |
| `bootstrap_unique_training_rows[]`, `n_training_rows` | Distinct training rows each tree saw |
| `features_tried_per_split`, `n_features` | Features each split may choose from |
| `root_split[]` | Each tree's first question `{feature, threshold}` |
| `validation_rmse_by_trees[k]` | Validation RMSE of the partial forest made of the first k+1 trees |
| `training_target_range` | Lowest and highest outcome in the training rows (forest predictions stay inside it) |

## `boosting` (GradientBoostingRegressor: 500 rounds, learning rate 0.1, depth 3)
| Field | Meaning |
|---|---|
| `init` | Round 0: the training average |
| `people.<id>.staged[m]` | Prediction after round m (`staged[0]` = `init`, 501 values) |
| `people.<id>.corrections[m-1]` | What tree m added. **Already multiplied by the learning rate.** |
| `rmse.train[m]`, `rmse.validation[m]` | Error after round m |
| `best_validation_round`, `best_validation_rmse` | The round with the lowest validation RMSE |
| `residual_snapshots` | 200 training rows: `observed` and `predictions["<round>"]` at selected rounds, for residual plots |
| `comparison_learning_rate_0_02` | A separately fitted model with learning rate 0.02: `rmse`, `best_validation_round`, `people.<id>.staged` |

`outputs/<key>_boosting_trees.json` holds the 500 trees (`feature`, `threshold`, `left`, `right`, `value`). Go left when `float32(x) <= threshold`. The prediction is `init + learning_rate × Σ value`.
