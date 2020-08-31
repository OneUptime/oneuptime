const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Enterprise Backend API', () => {
    beforeAll(async () => {
        jest.setTimeout(30000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
    });

    afterAll(async () => {
        await browser.close();
    });

    test('should get status ok from backend', async () => {
        await page.goto(utils.BACKEND_URL, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > p', e => {
            return e.innerHTML;
        });
        expect(response).toBe('Status: 200');
    });
});
