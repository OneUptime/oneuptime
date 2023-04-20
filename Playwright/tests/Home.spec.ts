import { test, expect, ElementHandle, Page } from '@playwright/test';

const BASE_URL: string =
    process.env['BASE_URL' as keyof typeof process.env] ||
    'https://test.oneuptime.com/';

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
    test('sign in button ', async ({ page }: { page: Page }) => {
        await page.getByRole('link', { name: 'Sign in' }).click();
        await expect(page).toHaveURL(/.*accounts/);
    });

    test('sign up button', async ({ page }: { page: Page }) => {
        const signUpButton: ElementHandle<Element> | null = await page.$(
            "[data-testid='Sign-up']"
        );
        if (signUpButton) {
            await signUpButton.click();
            await expect(page).toHaveURL(/.*accounts\/register/);
        }
    });
});

// test.describe("main page", () => {
//   test('images', async ({ page }) => {
//     const statusImage = page.getByRole('img', { name: 'Status Pages' }).first()
//     const MonitoringImage = page.getByRole('img', { name: 'Monitoring' });
//     const UserInterfaceImage= page.getByRole('img', { name: 'Inbox user interface' })
//       await expect(statusImage).toBeVisible();
//       await expect(MonitoringImage).toBeVisible();
//     await expect(UserInterfaceImage).toBeVisible();
//     await expect(page.getByTitle('open-source')).toHaveText('Open Source');
//     await expect(statusImage).toBeInViewport();
//   });

//     });
