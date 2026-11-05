import { spawnSync } from 'node:child_process';
import type { Page } from '@playwright/test';

const LINK_ERROR = 'Could not get a Salesforce login link';

// Local runs: asks the Salesforce CLI, which uses the login of the person running the runner.
function getLinkFromCli(org: string, query: string): string | undefined {
    if (!/^[\w.@-]+$/.test(org)) throw new Error('SF_TEST_ORG is not a valid org alias or username.');
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const result = spawnSync(`sf api request rest "/services/oauth2/singleaccess?${query}" --method GET --target-org ${org}`, {
        shell: true,
        env,
        encoding: 'utf8'
    });
    if (result.status !== 0) throw new Error(`${LINK_ERROR} from the Salesforce CLI.`);
    return (JSON.parse(result.stdout) as { frontdoor_uri?: string }).frontdoor_uri;
}

// GitHub runs: uses the session the workflow created for the user who started the run.
async function getLinkFromSession(instanceUrl: string, token: string, query: string): Promise<string | undefined> {
    const response = await fetch(`${instanceUrl}/services/oauth2/singleaccess?${query}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`${LINK_ERROR} (${response.status}).`);
    return ((await response.json()) as { frontdoor_uri?: string }).frontdoor_uri;
}

// Opens the org in the browser as the user who started this run, without a password.
// The runner or the workflow provides the session. See the README.
//
// It uses a single-use link so the access token never appears in a URL, and its errors
// leave the link out because GitHub logs in this repository are public.
export async function openOrgAsRunUser(page: Page, path = '/lightning/page/home'): Promise<void> {
    const org = process.env.SF_TEST_ORG;
    const instanceUrl = process.env.SF_TEST_INSTANCE_URL;
    const token = process.env.SF_TEST_ACCESS_TOKEN;
    if (!org && (!instanceUrl || !token)) {
        throw new Error('No Salesforce session. Start this spec from the Playwright Runner tab.');
    }

    const query = `redirect_uri=${encodeURIComponent(path)}`;
    const loginLink = org ? getLinkFromCli(org, query) : await getLinkFromSession(instanceUrl!, token!, query);
    if (!loginLink) throw new Error('Salesforce did not return a login link.');

    try {
        await page.goto(loginLink);
    } catch {
        throw new Error('Could not open the Salesforce login link.');
    }
}
