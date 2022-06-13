import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
    VALUE_TYPE,
} from '../Config';

let browser: Browser, page: Page;

describe('Container security page test', () => {
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
                `${HOME_URL.toString()}/product/docker-container-security`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const title: VALUE_TYPE = await page.title();
            expect(title).toBe('OneUptime | Docker Container Security');
        },
        OPERATION_TIMEOUT
    );

    test(
        'Animated gif on page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/product/docker-container-security`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const imgGif: VALUE_TYPE = await page.waitForSelector(
                '.imageshadow'
            );
            expect(imgGif).toBeTruthy();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/product/docker-container-security`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );

            const pageTittle: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '.Header-title'
            );
            const compareRate: VALUE_TYPE =
                await PuppeteerHelper.getTextContent(page, '#compare-rate');
            const enterpriseIntegration: VALUE_TYPE =
                await PuppeteerHelper.getTextContent(
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
                `${HOME_URL.toString()}/product/docker-container-security`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            await page.waitForSelector('#request-demo');
            await page.click('#request-demo');

            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
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
                `${HOME_URL.toString()}/product/docker-container-security`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const sodexoImg: VALUE_TYPE = await page.waitForSelector('.sodexo');
            const viewsonicImg: VALUE_TYPE = await page.waitForSelector(
                '.viewsonic'
            );
            const siemensImg: VALUE_TYPE = await page.waitForSelector(
                '.siemens'
            );
            const securonixImg: VALUE_TYPE = await page.waitForSelector(
                '.securonix'
            );
            const amerscImg: VALUE_TYPE = await page.waitForSelector('.amersc');
            const freshsalesImg: VALUE_TYPE = await page.waitForSelector(
                '.freshsales'
            );

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
