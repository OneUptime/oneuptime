import { Page, test } from '@playwright/test';
import { STATUS_PAGE_URL } from '../../Config';
import URL from 'Common/Types/API/URL';

test.describe('Basic Status Page', () => {
    test('should be able to load status page properly', async ({ page }: {page: Page}) => {
        if (!STATUS_PAGE_URL) {
            // pass this test if the user is not registered
            return;
        }

        // go to login page
        await page.goto(URL.fromString(STATUS_PAGE_URL.toString()).toString());

        // check if data-testid is present with status-page-overview
        await page.waitForSelector('[data-testid="status-page-overview"]'); // page loaded properly.
    });
});
