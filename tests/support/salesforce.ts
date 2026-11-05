import type { Page } from '@playwright/test';

// Opens the org in the browser as the user who started this run, without a password.
// The runner or the workflow provides the session. See the README.
//
// It uses a single-use link so the access token never appears in a URL, and its errors
// leave the link out because GitHub logs in this repository are public.
export async function openOrgAsRunUser(page: Page, path = '/lightning/page/home'): Promise<void> {
    const instanceUrl = process.env.SF_TEST_INSTANCE_URL;
    const token = process.env.SF_TEST_ACCESS_TOKEN;
    if (!instanceUrl || !token) {
        throw new Error('No Salesforce session. Start this spec from the Playwright Runner tab.');
    }

    const linkUrl = new URL('/services/oauth2/singleaccess', instanceUrl);
    linkUrl.searchParams.set('redirect_uri', path);
    const response = await fetch(linkUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        throw new Error(`Could not get a Salesforce login link (${response.status}).`);
    }
    const { frontdoor_uri: loginLink } = (await response.json()) as { frontdoor_uri?: string };
    if (!loginLink) throw new Error('Salesforce did not return a login link.');

    try {
        await page.goto(loginLink);
    } catch {
        throw new Error('Could not open the Salesforce login link.');
    }
}
