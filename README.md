# Explain the Model

**App:** https://apriljwalter-lgtm.github.io/Module--10-inclass/

| Section | Direct link | My viewer should walk away knowing… |
|---|---|---|
| Push & Pull (linear regression) | [#linear](https://apriljwalter-lgtm.github.io/Module--10-inclass/#linear) | My viewer should walk away knowing that a linear prediction is a starting point (the prediction for the training-average person) plus one signed push per feature, and that a push (coefficient × how far this person sits from the average) is not the same as the coefficient or as a feature's overall importance. |
| Wisdom of the Forest (random forest) | [#forest](https://apriljwalter-lgtm.github.io/Module--10-inclass/#forest) | My viewer should walk away knowing that a random forest averages 100 trees that differ because each saw a different random sample of people and features, and that the trees' disagreement is not a confidence interval. |
| One Correction at a Time (gradient boosting) | [#boosting](https://apriljwalter-lgtm.github.io/Module--10-inclass/#boosting) | My viewer should walk away knowing that boosting starts at the training average and adds one small correction per round, and that you stop where validation error is lowest, not where training error is lowest. |

An app that explains three regression models to an anonymous visitor who knows about machine learning and regression, but not how these algorithms work. Datasets: NHANES fasting glucose, blood pressure and lung function.

Submit the link to **this repository** on Canvas. Reviewers open the app link above.

## Design
Kept deliberately simple: one main picture per section, each with its own color.
- **➕ Push & Pull (orange):** a waterfall from the starting point to the prediction, then a row of colored chips that add up. One short card separates a coefficient (the same for everyone) from one person's push.
- **🌳 Wisdom of the Forest (green):** a jellybean jar where each bean is one tree's guess. A slider adds trees and the average line moves; partial forests are labelled.
- **🔨 One Correction at a Time (purple):** a sculptor chipping a block. Step through rounds (previous + chip = new), then use the training and validation error chart to pick where to stop.

Links can preselect a dataset and person, e.g. `?ds=sbp&p=P2#linear`.

## What's here
| File | What it is |
|---|---|
| `AGENT_BRIEF.md` | Rules for your AI coding agent (have it read this first) |
| `SETUP.md` | How to run and publish (GitHub Pages or Streamlit) |
| `check.md` | Numbers your finished app must still show |
| `index.html`, `app.js`, `m10.js` | GitHub Pages route (the one this app uses) |
| `streamlit_app.py`, `m10.py`, `requirements.txt` | Streamlit route (unused starter) |
| `outputs/` | Reference model outputs (field guide: `outputs/SCHEMA.md`) |
| `data/` | The three datasets and the data dictionary |

## Run locally
- GitHub Pages route: `python -m http.server 8000`, then open <http://localhost:8000>
