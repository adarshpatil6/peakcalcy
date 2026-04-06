# RMS Pro Sentinel

RMS Pro Sentinel is a Streamlit application for daily RMS work. It combines a regex-based Funds tab parser, an offline portfolio liquidation estimator, a stress-test workspace, and a safe scratchpad calculator.

## Features

- Funds tab parser for opening balance, collateral, SPAN, exposure, option premium, delivery margin, payin, and payout
- Margin shortfall or buffer calculation with utilization percentage
- Offline portfolio deep scan that estimates lot-by-lot liquidation impact from uploaded CSV margin columns
- Stress testing for required margin shock and collateral haircut
- Safe calculator with running table history and CSV export

## Local setup

1. Create and activate a virtual environment.
2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Run the app:

```powershell
streamlit run app.py
```

## Secure GitHub upload

1. Initialize git if needed:

```powershell
git init -b main
git add .
git commit -m "Build RMS Pro Sentinel Streamlit app"
```

2. Create a new private GitHub repository without adding a README, license, or `.gitignore`.
3. Add the remote and push:

```powershell
git remote add origin https://github.com/<your-user>/<your-private-repo>.git
git push -u origin main
```

## Streamlit Community Cloud deployment

1. Create a Streamlit Community Cloud account and connect your GitHub account.
2. In Streamlit Community Cloud settings, grant access to private repositories.
3. Click `Create app`.
4. Select the private GitHub repository, the `main` branch, and `app.py` as the entrypoint.
5. Open `Advanced settings`.
6. Choose Python `3.12`.
7. Deploy the app.

## Access control note

For Streamlit Community Cloud, a private app is not "anyone with the link." The secure mode is `Only specific people can view this app`, which requires invited viewers or repository developers. If you make the app public, anyone with the URL can open it and the app becomes public.

Streamlit's current Community Cloud docs also note that you are only allowed one private app at a time on Community Cloud.

Recommended secure setup:

1. Keep the GitHub repository private.
2. Deploy the app.
3. Open the app `Share` settings.
4. Set `Who can view this app` to `Only specific people can view this app`.
5. Invite viewer email addresses from the share dialog.

## CSV expectations for liquidation scan

The uploader works best when the CSV includes columns similar to:

- `tradingsymbol` or `instrument`
- `quantity` or `qty`
- `product`
- `exchange`
- `lot_size`
- `margin` or `total margin`

If you do not have a total margin column, map `SPAN` and `Exposure` columns instead. The liquidation output is an offline estimate based on uploaded data, not a live broker-side margin calculation.
