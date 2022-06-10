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

describe('Sla page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/legal/sla`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            const title: VALUE_TYPE = await page.title();
            expect(title).toBe(`OneUptime | Legal Center`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal/sla`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const pageTittle: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            const definitions: VALUE_TYPE =
                await PuppeteerHelper.getTextContent(page, '#definitions');
            const privasionServices: VALUE_TYPE =
                await PuppeteerHelper.getTextContent(
                    page,
                    '#provision-services'
                );
            const accoutType: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#account-type'
            );
            const disclaimer: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#disclaimer'
            );

            expect(pageTittle).toBe('Service Level Agreement');
            expect(definitions).toBe('DEFINITIONS.');
            expect(privasionServices).toBe('PROVISION OF SERVICES.');
            expect(accoutType).toBe('UPGRADING/DOWNGRADING ACCOUNT TYPE.');
            expect(disclaimer).toBe('DISCLAIMER.');
        },
        OPERATION_TIMEOUT
    );
});
