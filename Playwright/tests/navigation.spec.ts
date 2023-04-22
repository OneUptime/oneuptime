import { test, expect, ElementHandle, Page } from '@playwright/test';
const BASE_URL: string =
    process.env['BASE_URL' as keyof typeof process.env] ||
    'https://test.oneuptime.com/';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL);
});
test.describe('navigation bar', () => {
    test('product page', async ({ page }: { page: Page }) => {
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
        const requestDemo: ElementHandle<Element> | null = await page.$(
            "[data-testid='Request-demo']"
        );

        if (requestDemo) {
            await requestDemo.click();
            await requestDemo.hover();
            await expect(page).toHaveURL(/.*enterprise\/demo/);
        }
    });
});
