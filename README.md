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

The runner uses your Salesforce CLI login to the `testproject` org. To sign in, run `sf org login web --alias testproject` once. Set `SF_ORG` to use another org. It doesn't need the JWT key.

The runner only takes runs started by the user it's signed in as, so each person runs their own. Your runs stay Queued while your runner is off, and they start when you next run it.

## Run on GitHub

Complete the setup below, then click **Run on GitHub**. Until then, those runs fail with a GitHub error. The two buttons work side by side, and the local runner ignores GitHub runs.

1. The tab creates a `Testrun__c` record and starts `.github/workflows/playwright.yml`.
2. The workflow signs in as a service user and marks the run In Progress.
3. It signs in again as the user who started the run, and gives the spec that session.
4. It runs `tests/<module>/<spec>` and records a screenshot, plus a video if the test fails.
5. `scripts/report-to-salesforce.mjs` attaches those files to the record, as the service user, and sets the final status.
6. The tab polls the record every 4 seconds and shows the result.

A failed test also shows as failed on GitHub. If a sign-in fails, the reason appears as an error on the run's summary page. When the tab opens, it marks a GitHub run as failed if there's no result after 30 minutes. It does the same for a local run that started more than 30 minutes ago.

## Setup

### Salesforce: let the workflow sign in with JWT

1. Create a certificate and private key. Run this outside the repository, and never commit the key:
   ```
   openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 365 -subj "/CN=playwright-runner"
   ```
   The certificate expires after a year, and sign-ins stop working until you replace it.
2. In Setup, open **External Client App Manager** and create a new app.
3. Enable OAuth with these scopes: **Manage user data via APIs (api)**, **Manage user data via Web browsers (web)** and **Perform requests at any time (refresh_token, offline_access)**. A callback URL is required, but it is not used. `https://localhost` is fine.
4. Enable **JWT Bearer Flow** and upload `server.crt`.
5. In the app's policies, set **Permitted Users** to **Admin approved users are pre-authorized**, and add the **Git_hub_Permission** and **Playwright Integration** permission sets.
6. Assign **Playwright Integration** to the service user, which is the user the workflow reports results as.
7. Copy the app's consumer key.

Anyone with write access to this repository can get at the private key by changing the workflow, and can then sign in as any pre-authorized user. Limit who has write access, and don't give admins these permission sets unless you accept that.

### GitHub: add the repository secrets

In the repository, open **Settings > Secrets and variables > Actions** and add:

| Secret | Value |
| --- | --- |
| `SF_LOGIN_URL` | The org's My Domain URL, for example `https://your-domain.my.salesforce.com` |
| `SF_CLIENT_ID` | Consumer key |
| `SF_JWT_USERNAME` | The service user's username |
| `SF_JWT_PRIVATE_KEY` | The full contents of `server.key` |
| `SF_JWT_AUDIENCE` | Only for a sandbox: `https://test.salesforce.com` |

### Salesforce: let the org start the workflow

1. In GitHub, create a fine-grained personal access token for this repository with **Actions: Read and write**.
2. In Setup, open **Named Credentials > External Credentials > GitHub API**.
3. Under **Principals**, edit `GitHub_Principal` and add an authentication parameter named `Token` with the token as its value.
4. Assign the **Git_hub_Permission** permission set to everyone who will start runs. This also pre-authorizes them for the JWT sign-in.

## Add a spec

1. Add the file as `tests/<module developer name>/<name>.spec.ts`. File names can contain only letters, numbers, `.`, `_` and `-`.
2. In Salesforce, add a **spec** custom metadata record. Set **Module** to the module and **Spec File** to the file name, without the folder.

To test the org as the user who started the run, call `openOrgAsRunUser(page)` from `tests/support/salesforce.ts`. See `tests/Testingdata/org-login.spec.ts`. The spec sees what that user can see, and can change what they can change. Its screenshots and videos are attached to the run, where anyone who can open the record can view them.

## Run from the command line

```
npm ci
npx playwright install chromium
npx playwright test tests/Testingdata/login.spec.ts
```

`npm test` runs every spec except those tagged `@demo`, which fail on purpose, and `@org`, which need a session from the Playwright Runner tab.

## Public repository warning

This repository is public, so anyone can read the tests and the workflow logs. Keep credentials in secrets, not in spec files. Screenshots and videos are stored only in Salesforce.
