import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';

import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Home page test', () => {
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
            await page.goto(HOME_URL.toString(), {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title = await page.title();
            expect(title).toBe(
                'OneUptime | One Complete SRE and DevOps platform.'
            );
        },
        OPERATION_TIMEOUT
    );

    test(
        'Cookies text and button',
        async () => {
            await page.goto(HOME_URL.toString(), {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const text = await PuppeteerHelper.getTextContent(
                page,
                '#cookies-text'
            );
            const button = await PuppeteerHelper.getTextContent(
                page,
                '.#cookies-btn'
            );

            expect(button).toBeDefined();
            expect(text).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(HOME_URL.toString(), {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const pageTittle = await PuppeteerHelper.getTextContent(
                page,
                '#page-title'
            );
            const compareRate = await PuppeteerHelper.getTextContent(
                page,
                '#compare-rate'
            );
            const featureTittle = await PuppeteerHelper.getTextContent(
                page,
                '#feature-title'
            );

            expect(pageTittle).toBeDefined();
            expect(featureTittle).toBeDefined();
            expect(compareRate).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Request demo button',
        async () => {
            await page.goto(HOME_URL.toString(), {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
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
            await page.goto(HOME_URL.toString(), {
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
