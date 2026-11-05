import { expect, test } from '@playwright/test';
import { openOrgAsRunUser } from '../support/salesforce';

// Copy this pattern for specs that test the org as the user who started the run.
test('opens the org as the user who started the run', async ({ page }) => {
    await openOrgAsRunUser(page);
    await expect(page).toHaveURL(/\/lightning\//, { timeout: 30_000 });
});
