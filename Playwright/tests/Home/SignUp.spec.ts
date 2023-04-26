import { test, expect, ElementHandle, Page } from '@playwright/test';

const BASE_URL: string =
    process.env['BASE_URL' as keyof typeof process.env] ||
    'https://test.oneuptime.com/';

test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL);
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
