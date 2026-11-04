# Playwright automation

Tests started from the **Playwright Runner** tab in Salesforce.

## Run on your machine (no GitHub)

The **Run locally** button runs the spec on your machine, and Salesforce doesn't contact GitHub.

1. Start the runner, and leave it running:
   ```
   npm ci
   npx playwright install chromium
   npm run runner
   ```
   Add `-- --headed` to the last command to watch the browser.
2. Open the **Playwright Runner** tab, choose a module and a spec, and click **Run locally**.

The runner uses your Salesforce CLI login to the `testproject` org. Set `SF_ORG` to use another org. Runs started while the runner is off stay Queued, and they start when you next run it.

## Run on GitHub

Complete the setup below, then click **Run on GitHub**. Until then, those runs fail with a GitHub error. The two buttons work side by side, and the local runner ignores GitHub runs.

1. The tab creates a `Testrun__c` record and starts `.github/workflows/playwright.yml`.
2. The workflow runs `tests/<module>/<spec>` and records a screenshot and video.
3. `scripts/report-to-salesforce.mjs` attaches those files to the record and sets the final status.
4. The tab polls the record every 8 seconds and shows the result.

## Setup

### Salesforce: let the workflow sign in

1. In Setup, open **External Client App Manager** and create a new app.
2. Enable OAuth with the **Manage user data via APIs (api)** scope and enable the **Client Credentials Flow**. A callback URL is required, but it is not used. `https://localhost` is fine.
3. In the app's policies, enable Client Credentials and set **Run As** to the user the workflow should act as.
4. Assign the **Playwright Integration** permission set to that user.
5. Copy the app's consumer key and secret.

### GitHub: add the repository secrets

In the repository, open **Settings > Secrets and variables > Actions** and add:

| Secret | Value |
| --- | --- |
| `SF_LOGIN_URL` | The org's My Domain URL, for example `https://your-domain.my.salesforce.com` |
| `SF_CLIENT_ID` | Consumer key |
| `SF_CLIENT_SECRET` | Consumer secret |

### Salesforce: let the org start the workflow

1. In GitHub, create a fine-grained personal access token for this repository with **Actions: Read and write**.
2. In Setup, open **Named Credentials > External Credentials > GitHub API**.
3. Under **Principals**, edit `GitHub_Principal` and add an authentication parameter named `Token` with the token as its value.
4. Assign the **Git_hub_Permission** permission set to everyone who will start runs.

## Add a spec

1. Add the file as `tests/<module developer name>/<name>.spec.ts`. File names can contain only letters, numbers, `.`, `_` and `-`.
2. In Salesforce, add a **spec** custom metadata record. Set **Module** to the module and **Spec File** to the file name, without the folder.

## Run locally

```
npm ci
npx playwright install chromium
npx playwright test tests/Testingdata/login.spec.ts
```

## Public repository warning

This repository is public, so anyone can read the tests and the workflow logs. Keep credentials in secrets, not in spec files. Screenshots and videos are stored only in Salesforce.
