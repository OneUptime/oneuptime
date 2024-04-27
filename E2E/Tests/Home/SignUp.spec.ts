import { test, expect, Page } from '@playwright/test';
import { BASE_URL, IS_BILLING_ENABLED } from '../../Config';
import URL from 'Common/Types/API/URL';

test.beforeEach(async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
        return;
    }
    await page.goto(URL.fromString(BASE_URL.toString()).toString());
});
test('sign up button', async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
        return;
    }
    await page.getByTestId('Sign-up').click();
    await expect(page).toHaveURL(
        URL.fromString(BASE_URL.toString())
            .addRoute('/accounts/register')
            .toString()
    );
});
