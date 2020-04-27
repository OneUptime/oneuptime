const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check Server', () => {
    beforeAll(async () => {
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
    });

    afterAll(async () => {
        await browser.close();
    });

    test('should get hosts mapping from server', async () => {
        await page.goto(`${utils.BACKEND_URL}/server/hosts`, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > pre', e => {
            return e.innerHTML;
        });
        expect(response).toBe(
            '{"api":"https://fyipe.com/api","home":"https://fyipe.com","accounts":"https://fyipe.com/accounts","dashboard":"https://fyipe.com/dashboard"}'
        );
    });

    test('should get saas status true from server', async () => {
        await page.goto(`${utils.BACKEND_URL}/server/is-saas-service`, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > pre', e => {
            return e.innerHTML;
        });
        expect(response).toBe('{"result":true}');
    });
});
