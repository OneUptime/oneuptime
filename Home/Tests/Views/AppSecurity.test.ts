import puppeteer, { Browser, Page } from 'puppeteer';

import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT,
    HOME_URL,
} from '../config';

let browser: Browser, page: Page;

describe('App security page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/product/app-security`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title = await page.title();
            expect(title).toBe('OneUptime | App Security');
        },
        OPERATION_TIMEOUT
    );

    test(
        'Animated gif on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/product/app-security`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const imgGif = await page.waitForSelector('.imageshadow');
            expect(imgGif).toBeTruthy();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/product/app-security`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            await page.waitForSelector('.Header-title');
            await page.waitForSelector('#compare-rate');
            await page.waitForSelector('#enterprise-integration');

            const pageTittle = await page.$eval(
                '.Header-title',
                (e: Element) => {
                    return e.textContent;
                }
            );

            const compareRate = await page.$eval(
                '#compare-rate',
                (e: Element) => {
                    return e.textContent;
                }
            );

            const enterpriseIntegration = await page.$eval(
                '#enterprise-integration',
                (e: Element) => {
                    return e.textContent;
                }
            );

            expect(pageTittle).toBeDefined();
            expect(compareRate).toBeDefined();
            expect(enterpriseIntegration).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Request demo button',
        async () => {
            await page.goto(`${HOME_URL.toString()}/product/app-security`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('#request-demo');
            await page.click('#request-demo');

            await page.waitForSelector('.common-PageTitle');
            const text = await page.$eval('.common-PageTitle', (e: Element) => {
                return e.textContent;
            });

            expect(text).toContain('Request Demo');
            expect(page.url()).toBe(`${HOME_URL.toString()}/enterprise/demo`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Customer icons',
        async () => {
            await page.goto(`${HOME_URL.toString()}/product/app-security`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const sodexoImg = await page.waitForSelector('.sodexo');
            const viewsonicImg = await page.waitForSelector('.viewsonic');
            const siemensImg = await page.waitForSelector('.siemens');
            const securonixImg = await page.waitForSelector('.securonix');
            const amerscImg = await page.waitForSelector('.amersc');
            const freshsalesImg = await page.waitForSelector('.freshsales');

            expect(sodexoImg).toBeTruthy();
            expect(viewsonicImg).toBeTruthy();
            expect(siemensImg).toBeTruthy();
            expect(securonixImg).toBeTruthy();
            expect(amerscImg).toBeTruthy();
            expect(freshsalesImg).toBeTruthy();
        },
        OPERATION_TIMEOUT
    );
});
