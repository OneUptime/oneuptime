import puppeteer, { Browser, Page } from 'puppeteer';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT,
    HOME_URL,
} from '../config';

let browser: Browser, page: Page;

describe('Pricing page test', () => {
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

            await page.waitForSelector('#page-title');
            await page.waitForSelector('.Plan-title--enterprise');
            await page.waitForSelector('#compare-rate');
            await page.waitForSelector('.common-BodyText');

            const pageTittle = await page.$eval(
                '#page-title',
                (e: Element) => e.textContent
            );

            const enterprise = await page.$eval(
                '.Plan-title--enterprise',
                (e: Element) => e.textContent
            );

            const compareRate = await page.$eval(
                '#compare-rate',
                (e: Element) => e.textContent
            );
            const commonBodyText = await page.$eval(
                '.common-BodyText',
                (e: Element) => e.textContent
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
            await page.waitForSelector('#startup-rate');
            await page.waitForSelector('#growth-rate');
            await page.waitForSelector('#scale-rate');
            const startUp = await page.$eval(
                '#startup-rate',
                (e: Element) => e.textContent
            );
            const growth = await page.$eval(
                '#growth-rate',
                (e: Element) => e.textContent
            );

            const scale = await page.$eval(
                '#scale-rate',
                (e: Element) => e.textContent
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
