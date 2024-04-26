import { test, expect, Page } from '@playwright/test';
import { BASE_URL, IS_USER_REGISTERED, IS_BILLING_ENABLED } from '../../Config';
import Faker from 'Common/Utils/Faker';
import URL from 'Common/Types/API/URL';
test.describe('Account Registration', () => {
    test('should register a new account', async ({ page }: { page: Page }) => {
        if (IS_USER_REGISTERED) {
            // pass this test if user is already registered
            return;
        }

        await page.goto(
            URL.fromString(BASE_URL.toString())
                .addRoute('/accounts/register')
                .toString()
        );
        await page.getByTestId('email').click();
        await page.getByTestId('email').fill(Faker.generateEmail().toString());
        await page.getByTestId('email').press('Tab');
        await page.getByTestId('name').fill('sample');
        await page.getByTestId('name').press('Tab');

        if (IS_BILLING_ENABLED) {
            await page.getByTestId('companyName').fill('sample');
            await page.getByTestId('companyName').press('Tab');
            await page.getByTestId('companyPhoneNumber').fill('+15853641376');
            await page.getByTestId('companyPhoneNumber').press('Tab');
        }

        await page.getByTestId('password').fill('sample');
        await page.getByTestId('password').press('Tab');
        await page.getByTestId('confirmPassword').fill('sample');
        await page.getByTestId('Sign Up').click();

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
