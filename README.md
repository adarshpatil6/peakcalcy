# PeakCalcy

PeakCalcy is now a static GitHub Pages app. It runs entirely in the browser and includes:

- Funds tab parsing with regex extraction
- Margin shortfall or buffer analysis
- Offline liquidation estimation from uploaded CSV margin columns
- Stress testing for margin shock and collateral haircut
- Safe scratchpad calculations with local browser history

## Project files

- `index.html`: page structure
- `styles.css`: UI theme and layout
- `app.js`: parser, liquidation logic, stress logic, and scratchpad logic

## Local preview

You can open `index.html` directly in a browser, or serve the folder with any static server.

## GitHub Pages deployment

1. Create a GitHub repository for this project.
2. Push this folder to the repository.
3. In GitHub, open `Settings` -> `Pages`.
4. Under `Build and deployment`, choose `Deploy from a branch`.
5. Select the `main` branch and `/ (root)` folder.
6. Save the settings.
7. Wait for GitHub Pages to publish the site.

The URL will look like:

```text
https://<your-github-username>.github.io/<repository-name>/
```

If you want the cleanest naming, use a repository name like `peakcalcy`.

## Important hosting note

GitHub Pages is for static sites. This version is designed specifically for that model, so it does not require Python, Streamlit, or broker APIs.

On GitHub Free, GitHub Pages is available for public repositories. Private-repository Pages requires an eligible paid GitHub plan.

## CSV expectations for liquidation scan

The liquidation estimator works best when the CSV includes columns similar to:

- `tradingsymbol` or `instrument`
- `quantity` or `qty`
- `product`
- `exchange`
- `lot_size`
- `margin` or `total margin`

If you do not have a total margin column, map `SPAN` and `Exposure` columns instead.

## Data handling

Everything runs in the browser:

- Funds text stays local to the browser
- Scratchpad history is stored in local browser storage
- Uploaded CSV data is processed locally and not sent anywhere
