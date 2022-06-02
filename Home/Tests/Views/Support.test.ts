import puppeteer, { Browser, Page } from 'puppeteer';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT,
    HOME_URL,
} from '../config';

let browser: Browser, page: Page;

describe('Support page test', () => {
    beforeAll(async () => {
        jest.setTimeout(OPERATION_TIMEOUT);
        browser = await puppeteer.launch(PUPPETEER_OPTIONS);
        page = await browser.newPage();
        await page.setViewport(VIEW_PORT);
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Title of the page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/support`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const title = await page.title();
            expect(title).toBe('OneUptime | Help and Support');
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/support`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            await page.waitForSelector('#page-title');
            await page.waitForSelector('.title');

            const pageTittle = await page.$eval(
                '#page-title',
                (e: Element) => e.textContent
            );

            const featureTittle = await page.$eval(
                '.title',
                (e: Element) => e.textContent
            );

            expect(pageTittle).toBeDefined();
            expect(featureTittle).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Request demo button',
        async () => {
            await page.goto(`${HOME_URL.toString()}/support`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('#request-demo');
            await page.click('#request-demo');

            await page.waitForSelector('.common-PageTitle');
            const text = await page.$eval(
                '.common-PageTitle',
                (e: Element) => e.textContent
            );

            expect(text).toContain('Request Demo');
            expect(page.url()).toBe(`${HOME_URL.toString()}/enterprise/demo`);
        },
        OPERATION_TIMEOUT
    );
});
