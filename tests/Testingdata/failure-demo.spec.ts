import { expect, test } from '@playwright/test';

// Fails on purpose, to show how a failure looks in the Playwright Runner.
test('failure demo', async ({ page }) => {
    await page.goto('https://login.salesforce.com');
    await expect(page.locator('#element-that-does-not-exist')).toBeVisible({ timeout: 3_000 });
});
