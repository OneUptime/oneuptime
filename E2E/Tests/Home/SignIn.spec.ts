import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from '../../Config';
test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL.toString());
});
test('sign in button ', async ({ page }: { page: Page }) => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/.*accounts/);
});
