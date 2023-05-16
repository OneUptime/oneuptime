import { test, expect, Page } from '@playwright/test';
import BASE_URL from '../../Utils/BaseURL';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL);
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

        await expect(page).toHaveURL(/.*test\.oneuptime\.com/);
    });
});
