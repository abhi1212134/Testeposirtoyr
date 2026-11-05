import { expect, test } from '@playwright/test';
import { openOrgAsRunUser } from '../support/salesforce';

// Copy this pattern for specs that test the org as the user who started the run.
// The @org tag leaves it out of npm test, because it needs a session from the Runner tab.
test('opens the org as the user who started the run', { tag: '@org' }, async ({ page }) => {
    await openOrgAsRunUser(page);
    await expect(page).toHaveURL(/\/lightning\//, { timeout: 30_000 });
});
