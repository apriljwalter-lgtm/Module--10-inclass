# Check your app

Pick **Example person 1** in each section and compare. If your app shows different numbers, ask your agent why before you change anything.

| Dataset | Section | What to pick | Your app should show |
|---|---|---|---|
| NHANES: HbA1c → fasting glucose | Linear | Example person 1 (Female, age 58) | starting point **113.8** + pushes = prediction **99.4** mg/dL; biggest upward push: Waist circumference (+1.4) |
| | Forest | Example person 1 | average of all 100 trees = **108.6** mg/dL; tree 1 alone = 110.0 |
| | Boosting | Example person 1 | round 0 = **113.8**; round 1 = 112.4; round 500 = **102.5** mg/dL |
| | Boosting | validation curve | lowest validation RMSE **20.4** mg/dL at round **21** |
| NHANES: systolic blood pressure | Linear | Example person 1 (Male, age 41) | starting point **125.9** + pushes = prediction **123.3** mmHg; biggest upward push: Race / ethnicity (+1.3) |
| | Forest | Example person 1 | average of all 100 trees = **119.6** mmHg; tree 1 alone = 131.3 |
| | Boosting | Example person 1 | round 0 = **125.9**; round 1 = 125.7; round 500 = **127.1** mmHg |
| | Boosting | validation curve | lowest validation RMSE **16.1** mmHg at round **38** |
| NHANES: lung function (FEV₁) | Linear | Example person 1 (Male, age 9) | starting point **2878.6** + pushes = prediction **3217.9** mL; biggest upward push: Sex (+390.2) |
| | Forest | Example person 1 | average of all 100 trees = **1982.5** mL; tree 1 alone = 2003.0 |
| | Boosting | Example person 1 | round 0 = **2878.6**; round 1 = 2784.0; round 500 = **1831.8** mL |
| | Boosting | validation curve | lowest validation RMSE **537.7** mL at round **79** |

**Not a bug:** for lung function, the straight line predicts far too much for Example person 1, a 9-year-old. One straight line can't follow lungs growing in childhood and shrinking later. Showing where the line fails is a strength of an explainer, not a mistake.

**Pushes are measured from the training average**, including the average mix of men and women (and of ethnic groups). So even a man, or a Non-Hispanic White person, gets a small sex or ethnicity push. The "reference group" is only how the 0/1 columns are coded.
