# Setup: get a public link (before class, 15–20 minutes)

You need **both**:
- a **GitHub repository**, which is your backup;
- a **public link** that opens without signing in.

The activity website has the same steps with pictures and troubleshooting: <https://snsie.github.io/regression-activity/hosting.html>

| | Route A: GitHub Pages | Route B: Streamlit Community Cloud |
|---|---|---|
| You write | HTML + JavaScript (`index.html`, `app.js`) | Python (`streamlit_app.py`) |
| Good if you… | like web pages, or want full design freedom | used Streamlit before |
| Runs Python? | No: it's static files only | Yes |

## 1. Make your repository
1. Unzip this starter. Its folder is your project.
2. On GitHub, click **New repository**, give it a name (e.g. `explain-the-model`) and make it **public**. Don't add a README; the starter has one.
3. In the starter folder, run:
   ```bash
   git init -b main
   git add .
   git commit -m "Starter"
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
   *No git on your computer?* On the new repository's page, click **uploading an existing file** and drag in everything from the starter folder, including the `data` and `outputs` folders.

## 2. Run it on your computer
- **Route A:** `python -m http.server 8000`, then open <http://localhost:8000>. (Opening `index.html` directly won't load the data.)
- **Route B:** `uv run --with streamlit,pandas,numpy streamlit run streamlit_app.py`

## 3. Publish
- **Route A:** on GitHub, go to **Settings → Pages**, set **Source: Deploy from a branch** with branch `main` and folder `/ (root)`, and click **Save**. After 1–2 minutes your link is `https://<username>.github.io/<repo>/`.
- **Route B:** at [share.streamlit.io](https://share.streamlit.io), click **Create app**, pick your repository, branch `main` and file `streamlit_app.py`, then click **Deploy**.

## 4. Check it like a reviewer
Open your link in a **private/incognito window**. It must load without signing in. Put the link at the top of `README.md` (the starter has a place for it), then commit and push. You'll submit this repository's link on Canvas.

## Something broke?
- **The Pages link shows a 404:** wait 2 minutes, and check that Pages is set to `main` and `/ (root)`.
- **Streamlit says "ModuleNotFoundError":** add the package to `requirements.txt` and push.
- **Still stuck:** switch to the other route. Both use the same data and the same rules.
