import { expect, test } from '@playwright/test';

// Salesforce serves more than one version of this page, with different field ids.
// All of them have an email input.
test('Salesforce login page asks for a username', async ({ page }) => {
    await page.goto('https://login.salesforce.com');
    await expect(page.locator('input[type="email"]')).toBeVisible();
});
