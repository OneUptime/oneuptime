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

describe('Legal page test', () => {
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
            await page.goto(`${HOME_URL.toString()}/legal`, {
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
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });

            const pageTittle: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '.legal'
            );

            expect(pageTittle).toBeDefined();
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/terms',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/terms"]');
            await page.click('a[href$="/legal/terms"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('Terms of Use');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/terms`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/privacy',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/privacy"]');
            await page.click('a[href$="/legal/privacy"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('Privacy Policy');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/privacy`);
        },
        OPERATION_TIMEOUT
    );
    test(
        'Click link to /legal/sla',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/sla"]');
            await page.click('a[href$="/legal/sla"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('Service Level Agreement');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/sla`);
        },
        OPERATION_TIMEOUT
    );
    test(
        'Click link to /legal/gdpr',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/gdpr"]');
            await page.click('a[href$="/legal/gdpr"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('General Data Protection Regulation (GDPR)');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/gdpr`);
        },
        OPERATION_TIMEOUT
    );
    test(
        'Click link to /legal/ccpa',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/ccpa"]');
            await page.click('a[href$="/legal/ccpa"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('CCPA');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/ccpa`);
        },
        OPERATION_TIMEOUT
    );
    test(
        'Click link to /legal/hipaa',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/hipaa"]');
            await page.click('a[href$="/legal/hipaa"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain(
                'Health Insurance Portability and Accountability Act'
            );
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/hipaa`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/iso-27001',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/iso-27001"]');
            await page.click('a[href$="/legal/iso-27001"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain(
                'ISO/IEC 27001 INFORMATION SECURITY MANAGEMENT'
            );
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/iso-27001`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/iso-27017',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/iso-27017"]');
            await page.click('a[href$="/legal/iso-27017"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('ISO/IEC 27017:2015');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/iso-27017`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/iso-27018',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/iso-27018"]');
            await page.click('a[href$="/legal/iso-27018"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('ISO/IEC 27018:2014');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/iso-27018`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/soc-2',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/soc-2"]');
            await page.click('a[href$="/legal/soc-2"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('SOC 2');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/soc-2`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/soc-3',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/soc-3"]');
            await page.click('a[href$="/legal/soc-3"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('SOC 3');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/soc-3`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/data-residency',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/data-residency"]');
            await page.click('a[href$="/legal/data-residency"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain(
                'Data Residency for OneUptime Enterprise Customers'
            );
            expect(page.url()).toBe(
                `${HOME_URL.toString()}/legal/data-residency`
            );
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/pci',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/pci"]');
            await page.click('a[href$="/legal/pci"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('PCI DSS');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/pci`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/dmca',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/dmca"]');
            await page.click('a[href$="/legal/dmca"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('DMCA Policy');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/dmca`);
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/subprocessors',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/subprocessors"]');
            await page.click('a[href$="/legal/subprocessors"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('Subprocessors');
            expect(page.url()).toBe(
                `${HOME_URL.toString()}/legal/subprocessors`
            );
        },
        OPERATION_TIMEOUT
    );

    test(
        'Click link to /legal/contact',
        async () => {
            await page.goto(`${HOME_URL.toString()}/legal`, {
                waitUntil: 'networkidle0',
                timeout: OPERATION_TIMEOUT,
            });
            await page.waitForSelector('a[href$="/legal/contact"]');
            await page.click('a[href$="/legal/contact"]');
            const text: VALUE_TYPE = await PuppeteerHelper.getTextContent(
                page,
                '#title'
            );
            expect(text).toContain('Contact');
            expect(page.url()).toBe(`${HOME_URL.toString()}/legal/contact`);
        },
        OPERATION_TIMEOUT
    );
});
