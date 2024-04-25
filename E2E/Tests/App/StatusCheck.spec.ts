import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from '../../Config';
import URL from 'Common/Types/API/URL';

test.describe('check live and health check of the app', () => {
    test('check if app status is ok', async ({ page }: { page: Page }) => {
        await page.goto(
            `${URL.fromString(BASE_URL.toString())
                .addRoute('/status')
                .toString()}`
        );
        const content: string = await page.content();
        expect(content).toContain('{"status":"ok"}');
    });

    test('check if app is ready', async ({ page }: { page: Page }) => {
        await page.goto(
            `${URL.fromString(BASE_URL.toString())
                .addRoute('/status/ready')
                .toString()}`
        );
        const content: string = await page.content();
        expect(content).toContain('{"status":"ok"}');
    });

    test('check if app is live', async ({ page }: { page: Page }) => {
        await page.goto(
            `${URL.fromString(BASE_URL.toString())
                .addRoute('/status/live')
                .toString()}`
        );
        const content: string = await page.content();
        expect(content).toContain('{"status":"ok"}');
    });
});
