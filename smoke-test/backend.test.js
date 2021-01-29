const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check Backend', () => {
    beforeAll(async done => {
        jest.setTimeout(30000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test('should get status ok from backend', async done => {
        await page.goto(utils.BACKEND_URL, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > pre', e => {
            return e.innerHTML;
        });
        expect(response).toBe(
            '{"status":200,"message":"Service Status - OK","serviceType":"fyipe-api"}'
        );
        done();
    });
});
