const utils= require('./test-utils');
const puppeteer = require('puppeteer');

var page, browser;

beforeAll(async () => {
    browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
    page = await browser.newPage();
})

afterAll(async () => {
    await browser.close();
})

describe('Check api-docs up', () => {
    test('should get title of api docs page', async () => {
        await page.goto(utils.APIDOCS_URL, {
            waitUntil: 'domcontentloaded'
        });
        const response = await page.$eval('head > title', (e) => {
            return e.innerHTML;
        });
        expect(response).toBe('Fyipe API Documentation');
    })
})
