import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Pricing page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/pricing`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title = await page.title();

            expect(title).toBe('OneUptime | Pricing');
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/pricing`, {
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
            const enterprise = await PuppeteerHelper.getTextContent(
                page,
                '.Plan-title--enterprise'
            );
            const commonBodyText = await PuppeteerHelper.getTextContent(
                page,
                '.common-BodyText'
            );

            expect(pageTittle).toBeDefined();
            expect(enterprise).toBe('Enterprise');
            expect(compareRate).toBe(
                'At 10% the cost, saves you thousands as you grow.'
            );
            expect(commonBodyText).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Check for plan',
        async () => {
            await page.goto(`${HOME_URL.toString()}/pricing`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const startUp = await PuppeteerHelper.getTextContent(
                page,
                '#startup-rate'
            );
            const growth = await PuppeteerHelper.getTextContent(
                page,
                '#growth-rate'
            );
            const scale = await PuppeteerHelper.getTextContent(
                page,
                '#scale-rate'
            );

            expect(startUp).toContain('$22');
            expect(growth).toContain('$50');
            expect(scale).toContain('$99');
        },
        OPERATION_TIMEOUT
    );

    test(
        'Request demo button',
        async () => {
            await page.goto(`${HOME_URL.toString()}/pricing`, {
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
});
