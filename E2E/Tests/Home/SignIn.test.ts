import { test, expect, Page } from '@playwright/test';

import BASE_URL from '../../Utils/BaseURL';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL);
});
test('sign in button ', async ({ page }: { page: Page }) => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/.*accounts/);
});
