import { test, expect, Page } from '@playwright/test';

const BASE_URL: string =
    process.env['BASE_URL' as keyof typeof process.env] ||
    'https://test.oneuptime.com/';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL);
});
test('sign in button ', async ({ page }: { page: Page }) => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/.*accounts/);
});
