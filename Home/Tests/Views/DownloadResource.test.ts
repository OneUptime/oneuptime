import puppeteer, { Browser, Page } from 'puppeteer';
import PuppeteerHelper from 'Common/Tests/TestingUtils/PuppeteerHelper';
import {
    OPERATION_TIMEOUT,
    PUPPETEER_OPTIONS,
    VIEW_PORT_OPTIONS,
    HOME_URL,
} from '../Config';

let browser: Browser, page: Page;

describe('Download resource page test', () => {
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
                `${HOME_URL.toString()}/enterprise/download-resource/:resourceName`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const title = await page.title();
            expect(title).toBe(`OneUptime | Download Resource`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Confirm text on page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/enterprise/download-resource/:resourceName`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );

            const pageTittle = await PuppeteerHelper.getTextContent(
                page,
                '.Header-title'
            );
            const firstIntrotext = await PuppeteerHelper.getTextContent(
                page,
                '.common-IntroText'
            );
            const secondIntrotext = await PuppeteerHelper.getTextContent(
                page,
                '.intro-text'
            );
            const headline = await PuppeteerHelper.getTextContent(
                page,
                '.cta-headline'
            );

            expect(pageTittle).toBe('Resource Title');
            expect(firstIntrotext).toBeDefined();
            expect(secondIntrotext).toBeDefined();
            expect(headline).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Check for form on page',
        async () => {
            await page.goto(
                `${HOME_URL.toString()}/enterprise/download-resource/:resourceName`,
                {
                    waitUntil: 'networkidle0',
                    timeout: OPERATION_TIMEOUT,
                }
            );
            const fullName = await PuppeteerHelper.getTextContent(
                page,
                'input[name=fullname]'
            );
            const email = await PuppeteerHelper.getTextContent(
                page,
                'input[name=email]'
            );
            const phone = await PuppeteerHelper.getTextContent(
                page,
                'input[name=phone]'
            );

            const website = await PuppeteerHelper.getTextContent(
                page,
                'input[name=website]'
            );

            const country = await PuppeteerHelper.getTextContent(
                page,
                'select[name=country]'
            );

            const companySize = await PuppeteerHelper.getTextContent(
                page,
                'select[id=volume]'
            );

            const button = await PuppeteerHelper.getTextContent(
                page,
                'input[id=request-resource-btn]'
            );
            expect(fullName).toBeDefined();
            expect(email).toBeDefined();
            expect(phone).toBeDefined();
            expect(website).toBeDefined();
            expect(country).toBeDefined();
            expect(companySize).toBeDefined();
            expect(button).toBeDefined();
        },
        OPERATION_TIMEOUT
    );
});
