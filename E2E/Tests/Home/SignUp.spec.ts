import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from '../../Config';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL.toString());
});
test('sign up button', async ({ page }: { page: Page }) => {
    await page.getByTestId('Sign-up').click();
    await expect(page).toHaveURL(
        BASE_URL.addRoute('/accounts/register').toString()
    );
});
