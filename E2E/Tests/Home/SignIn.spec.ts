import { test, expect, Page } from '@playwright/test';
import { BASE_URL, IS_BILLING_ENABLED } from '../../Config';
import URL from 'Common/Types/API/URL';
test.beforeEach(async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
        return;
    }
    await page.goto(URL.fromString(BASE_URL.toString()).toString());
});
test('sign in button ', async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
        return;
    }
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/.*accounts/);
});
