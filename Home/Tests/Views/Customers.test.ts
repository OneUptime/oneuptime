import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Customers page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/customers`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title = await page.title();
            expect(title).toBe(
                `OneUptime | One Complete SRE and DevOps platform.`
            );
        },
        OPERATION_TIMEOUT
    );

    test(
        'Images of customers',
        async () => {
            await page.goto(`${HOME_URL.toString()}/customers`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const img1 = await page.waitForSelector('.Icon-img24');
            const img2 = await page.waitForSelector('.Icon-img29');
            const img3 = await page.waitForSelector('.Icon-img12');
            const img4 = await page.waitForSelector('.Icon-img23');
            const img5 = await page.waitForSelector('.Icon-img34');
            const img6 = await page.waitForSelector('.Icon-img17');
            const img7 = await page.waitForSelector('.Icon-img38');
            const img8 = await page.waitForSelector('.Icon-img13');
            const img9 = await page.waitForSelector('.Icon-img19');
            const img10 = await page.waitForSelector('.Icon-img15');
            const img11 = await page.waitForSelector('.Icon-img27');
            const img12 = await page.waitForSelector('.Icon-img4');
            expect(img1).toBeTruthy();
            expect(img2).toBeTruthy();
            expect(img3).toBeTruthy();
            expect(img4).toBeTruthy();
            expect(img5).toBeTruthy();
            expect(img6).toBeTruthy();
            expect(img7).toBeTruthy();
            expect(img8).toBeTruthy();
            expect(img9).toBeTruthy();
            expect(img10).toBeTruthy();
            expect(img11).toBeTruthy();
            expect(img12).toBeTruthy();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/customers`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const pageTittle = await PuppeteerHelper.getTextContent(
                page,
                '.Header-title'
            );
            const title = await PuppeteerHelper.getTextContent(page, '.title');

            expect(pageTittle).toBeDefined();
            expect(title).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Request demo button',
        async () => {
            await page.goto(`${HOME_URL.toString()}/customers`, {
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
