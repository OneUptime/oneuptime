import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Enterprice Overview page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/enterprise/overview`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title = await page.title();
            expect(title).toBe(`OneUptime | Enterprises`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/enterprise/overview`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const pageTittle = await PuppeteerHelper.getTextContent(
                page,
                '.Header-title'
            );
            const engineer = await PuppeteerHelper.getTextContent(
                page,
                '#engineer'
            );
            const installCloud = await PuppeteerHelper.getTextContent(
                page,
                '#install-cloud'
            );
            const securityEncruption = await PuppeteerHelper.getTextContent(
                page,
                '#security-encryption'
            );
            const enterpriseIntegration = await PuppeteerHelper.getTextContent(
                page,
                '#enterprise-integration'
            );
            expect(pageTittle).toBeDefined();
            expect(engineer).toBeDefined();
            expect(installCloud).toBeDefined();
            expect(securityEncruption).toBeDefined();
            expect(enterpriseIntegration).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Request demo button',
        async () => {
            await page.goto(`${HOME_URL.toString()}/enterprise/overview`, {
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
            await page.goto(`${HOME_URL.toString()}/enterprise/overview`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const cloudboostImg = await page.waitForSelector('.cloudboost');
            const viewsonicImg = await page.waitForSelector('.viewsonic');
            const siemensImg = await page.waitForSelector('.siemens');
            const hersheysImg = await page.waitForSelector('.hersheys');
            const elasticstackImg = await page.waitForSelector('.elasticstack');
            const freshsalesImg = await page.waitForSelector('.freshsales');

            expect(cloudboostImg).toBeTruthy();
            expect(viewsonicImg).toBeTruthy();
            expect(siemensImg).toBeTruthy();
            expect(hersheysImg).toBeTruthy();
            expect(elasticstackImg).toBeTruthy();
            expect(freshsalesImg).toBeTruthy();
        },
        OPERATION_TIMEOUT
    );
});
