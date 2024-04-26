import { test, expect, Page } from '@playwright/test';
import {
    BASE_URL,
    IS_USER_REGISTERED,
    REGISTERED_USER_EMAIL,
    REGISTERED_USER_PASSWORD,
} from '../../Config';
import URL from 'Common/Types/API/URL';

test.describe('Login', () => {
    test('should be able to login', async ({ page }: { page: Page }) => {
        if (!IS_USER_REGISTERED) {
            // pass this test if the user is not registered
            return;
        }

        // go to login page
        await page.goto(
            URL.fromString(BASE_URL.toString())
                .addRoute('/accounts/')
                .toString()
        );

        await page.locator('input[type="email"]').click();
        await page
            .locator('input[type="email"]')
            .fill(REGISTERED_USER_EMAIL.toString());
        await page.locator('input[type="email"]').press('Tab');
        await page
            .locator('input[type="password"]')
            .fill(REGISTERED_USER_PASSWORD.toString());
        await page.locator('input[type="password"]').press('Enter');

        // wait for navigation with base url
        await page.waitForURL(
            URL.fromString(BASE_URL.toString())
                .addRoute('/dashboard/welcome')
                .toString()
        );
        expect(page.url()).toBe(
            URL.fromString(BASE_URL.toString())
                .addRoute('/dashboard/welcome')
                .toString()
        );

        await page.getByTestId('create-new-project-button').click();
    });
});
