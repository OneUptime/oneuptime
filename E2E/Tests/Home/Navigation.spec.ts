import { BASE_URL, IS_BILLING_ENABLED } from '../../Config';
import { Page, expect, test } from '@playwright/test';
import URL from 'Common/Types/API/URL';

test.beforeEach(async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
        return;
    }

    await page.goto(URL.fromString(BASE_URL.toString()).toString());
});

test.describe('navigation bar', () => {
    test('product page', async ({ page }: { page: Page }) => {
        if (!IS_BILLING_ENABLED) {
            return;
        }
        await page.getByRole('button', { name: 'Products' }).click();
        await page.getByRole('button', { name: 'Products' }).hover();
        await expect(page.getByRole('button', { name: 'Products' })).toHaveText(
            /Products/
        );
        await expect(
            page.getByRole('button', { name: 'Products' })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Products' })
        ).toBeInViewport();
    });

    test('pricing page', async ({ page }: { page: Page }) => {
        if (!IS_BILLING_ENABLED) {
            return;
        }
        await page.getByRole('link', { name: 'Pricing' }).click();
        await page.getByRole('link', { name: 'Pricing' }).hover();
        await expect(page.getByRole('link', { name: 'Pricing' })).toHaveText(
            /Pricing/
        );
        await expect(page.getByRole('link', { name: 'Pricing' })).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Pricing' })
        ).toBeInViewport();
        await expect(page).toHaveURL(/.*pricing/);
    });

    test('Enterprise', async ({ page }: { page: Page }) => {
        if (!IS_BILLING_ENABLED) {
            return;
        }
        await page.getByRole('link', { name: 'Enterprise' }).click();
        await page.getByRole('link', { name: 'Enterprise' }).hover();
        await expect(
            page.getByRole('link', { name: 'Enterprise' })
        ).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Enterprise' })
        ).toBeInViewport();
        await expect(page.getByRole('link', { name: 'Enterprise' })).toHaveText(
            /Enterprise/
        );
        await expect(page).toHaveURL(/.*enterprise\/overview/);
    });

    test('Request Demo', async ({ page }: { page: Page }) => {
        if (!IS_BILLING_ENABLED) {
            return;
        }
        await page.getByTestId('request-demo-desktop-link').click();
        await expect(page).toHaveURL(/.*enterprise\/demo/);
    });
});
