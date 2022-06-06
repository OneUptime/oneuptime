import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Dmca page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/legal/iso-27017`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title = await page.title();
            expect(title).toBe(`OneUptime | Legal Center`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal/iso-27017`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const pageTittle = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            const certificate = await PuppeteerHelper.getTextContent(
                page,
                '#certificate'
            );

            expect(pageTittle).toBe('ISO/IEC 27017:2015');
            expect(certificate).toBe('Certificate of Registration');
        },
        OPERATION_TIMEOUT
    );
});
