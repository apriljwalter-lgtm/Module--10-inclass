# The data

Three real health datasets from the CDC's National Health and Nutrition Examination Survey (NHANES). One row = one person.
- `row_id` is a row number.
- `split` says whether the row is **train** (80%, used to fit the models) or **validation** (20%, used to check them and to choose when boosting stops).
- These describe this survey sample, not the whole US population.

## `glucose.csv`: fasting glucose (2,397 adults, NHANES 2017–2018)
| Column | Meaning | Units |
|---|---|---|
| `hba1c` | HbA1c: average blood sugar over about 3 months | % |
| `age` | Age (80 means 80 or older) | years |
| `bmi` | Body mass index | kg/m² |
| `waist_cm` | Waist circumference | cm |
| `female` | 1 = female, 0 = male | 0/1 |
| `fasting_glucose` | **Target:** blood sugar after fasting | mg/dL |

## `sbp.csv`: systolic blood pressure (4,370 adults, NHANES 2017–2018)
| Column | Meaning | Units |
|---|---|---|
| `age` | Age (80 means 80 or older) | years |
| `bmi` | Body mass index | kg/m² |
| `waist_cm` | Waist circumference | cm |
| `female` | 1 = female, 0 = male | 0/1 |
| `income_poverty_ratio` | Family income ÷ the poverty line (5 means 5 or more) | ratio |
| `eth_mexican_american`, `eth_other_hispanic`, `eth_nh_black`, `eth_nh_asian`, `eth_other_multiracial` | Race/ethnicity as 0/1 columns. All zeros = **Non-Hispanic White** (the reference group) | 0/1 |
| `systolic_bp` | **Target:** systolic blood pressure, mean of up to 3 readings | mmHg |

## `fev1.csv`: lung function (5,820 people aged 6–79, NHANES 2011–2012)
| Column | Meaning | Units |
|---|---|---|
| `age` | Age | years |
| `female` | 1 = female, 0 = male | 0/1 |
| `bmi` | Body mass index | kg/m² |
| `income_poverty_ratio` | Family income ÷ the poverty line (5 means 5 or more) | ratio |
| `fev1` | **Target:** FEV₁, air blown out in the first second | mL |

Height is left out on purpose, so the models have to learn how lung size changes with age.

**Sources:**
- CDC/NCHS, NHANES 2017–2018 and 2011–2012 public-use files.
- Prepared with the regression-app's `pipeline/datasets.py`. `manifest.json` records the source commit, versions and row counts.
