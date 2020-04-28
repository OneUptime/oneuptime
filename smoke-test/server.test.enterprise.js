const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check Enterprise Server', () => {
    beforeAll(async () => {
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
    });

    afterAll(async () => {
        await browser.close();
    });

    test('should get saas status false from server', async () => {
        await page.goto(`${utils.BACKEND_URL}/server/is-saas-service`, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > pre', e => {
            return e.innerHTML;
        });
        expect(response).toBe('{"result":false}');
    });
});
