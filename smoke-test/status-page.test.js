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

describe('Check status-page up', () => {
    test('should load status page and show login screen', async () => {
        await page.goto(utils.STATUSPAGE_URL, {
            waitUntil: 'domcontentloaded'
        });
        await page.waitFor(2000);
        const response = await page.$eval('#login-button > span', (e) => {
            return e.innerHTML;
        });
        expect(response).toBe('Sign in to your account');
    })
})
