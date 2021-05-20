const utils = require('../../test-utils');
const puppeteer = require('puppeteer');
const init = require('../../test-init');
let page, browser;

describe('Check Backend', () => {
    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        jest.retryTimes(3);
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
            waitUntil: 'networkidle2',
        });
        const response = await init.page$Eval(page, 'body > pre', e => {
            return e.innerHTML;
        });
        expect(response).toBe(
            '{"status":200,"message":"Service Status - OK","serviceType":"fyipe-api"}'
        );
        done();
    });
});
