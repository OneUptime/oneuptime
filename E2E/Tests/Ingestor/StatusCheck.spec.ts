import { test, expect } from '@playwright/test';
import { BASE_URL } from '../../Config';
import URL from 'Common/Types/API/URL';

test.describe('check live and health check of the app', () => {
    
    test('check if app status is ok', async ({ page }) => {
        await page.goto(`${URL.fromString(BASE_URL.toString()).addRoute("/ingestor/status").toString()}`);
        const content = await page.content();
        expect(content).toContain('{"status":"ok"}');
    });

    test('check if app is ready', async ({ page }) => {
        await page.goto(`${URL.fromString(BASE_URL.toString()).addRoute("/ingestor/status/ready").toString()}`);
        const content = await page.content();
        expect(content).toContain('{"status":"ok"}');
    });

    test('check if app is live', async ({ page }) => {
        await page.goto(`${URL.fromString(BASE_URL.toString()).addRoute("/ingestor/status/live").toString()}`);
        const content = await page.content();
        expect(content).toContain('{"status":"ok"}');
    });
});
