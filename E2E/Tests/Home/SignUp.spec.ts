import { test, expect, Page } from '@playwright/test';

import BASE_URL from '../../Utils/BaseURL';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL);
});
test('sign up button', async ({ page }: { page: Page }) => {
    await page.getByTestId('Sign-up').click();
    await expect(page).toHaveURL(BASE_URL + '/accounts/register');
});
