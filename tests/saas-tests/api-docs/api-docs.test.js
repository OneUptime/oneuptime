const utils = require('../../../test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check api-docs up', () => {
    beforeAll(async done => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test('should get title of api docs page', async done => {
        await page.goto(utils.APIDOCS_URL, {
            waitUntil: 'domcontentloaded',
        });
        const response = await page.$eval('head > title', e => {
            return e.innerHTML;
        });
        expect(response).toBe('Fyipe API Documentation');
        done();
    }, 60000);
});
