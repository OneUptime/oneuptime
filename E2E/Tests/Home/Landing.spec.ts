import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from '../../Config';
import URL from 'Common/Types/API/URL';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(URL.fromString(BASE_URL.toString()).toString());
});
test.describe('check if pages loades with its title', () => {
    test('has title', async ({ page }: { page: Page }) => {
        await expect(page).toHaveTitle(
            /OneUptime | One Complete SRE and DevOps platform./
        );
    });
    test('oneUptime link navigate to homepage', async ({
        page,
    }: {
        page: Page;
    }) => {
        await page
            .getByRole('link', { name: 'OneUptime', exact: true })
            .click();

        await expect(page).toHaveURL(
            URL.fromString(BASE_URL.toString()).toString()
        );
    });
});
