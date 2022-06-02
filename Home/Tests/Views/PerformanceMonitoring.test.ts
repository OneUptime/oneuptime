import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';

import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Performance monitoring page test', () => {
    beforeAll(async () => {
        jest.setTimeout(OPERATION_TIMEOUT);
        browser = await puppeteer.launch(PUPPETEER_OPTIONS);
        page = await browser.newPage();
        await page.setViewport(VIEW_PORT_OPTIONS);
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Title of the page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/product/performance-monitoring`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const title = await page.title();
            expect(title).toBe(`OneUptime | Monitor Application Performance`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Animated gif on page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/product/performance-monitoring`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const imgGif = await page.waitForSelector('#uptime-monitoring-gif');
            expect(imgGif).toBeTruthy();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/product/performance-monitoring`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const pageTittle = await PuppeteerHelper.getTextContent(
                page,
                '.Header-title'
            );
            const compareRate = await PuppeteerHelper.getTextContent(
                page,
                '#compare-rate'
            );
            const enterpriseIntegration = await PuppeteerHelper.getTextContent(
                page,
                '#enterprise-integration'
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
            await page.goto(
                `${HOME_URL.toString()}/product/performance-monitoring`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            await page.waitForSelector('#request-demo');
            await page.click('#request-demo');
            const text = await PuppeteerHelper.getTextContent(
                page,
                '.common-PageTitle'
            );

            expect(text).toContain('Request Demo');
            expect(page.url()).toBe(`${HOME_URL.toString()}/enterprise/demo`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Customer icons',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/product/performance-monitoring`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
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
