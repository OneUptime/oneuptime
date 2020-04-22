const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check api-docs up', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    test('should get title of api docs page', async () => {
        await page.goto(utils.APIDOCS_URL, {
            waitUntil: 'domcontentloaded',
        });
        const response = await page.$eval('head > title', e => {
            return e.innerHTML;
        });
        expect(response).toBe('Fyipe API Documentation');
    }, 30000);
});
