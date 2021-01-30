const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check status-page up', () => {
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

    test('should load status page and show status page is not present', async done => {
        await page.goto(`${utils.STATUSPAGE_URL}/fakeStatusPageId`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForTimeout(2000);
        const response = await page.$eval('#app-loading > div', e => {
            return e.innerHTML;
        });
        expect(response).toBe('Page Not Found');
        done();
    }, 30000);
});
