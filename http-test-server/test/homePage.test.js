const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');

let browser;
let page;

let bodyText = utils.generateRandomString();

describe('HTTP Home page', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
    });
	
    afterAll(async () => {
        await browser.close();
    });
	
    it('Should return html page if response type is changed', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings', { waitUntil: 'networkidle2' });
        await page.evaluate(() => document.getElementById('responseTime').value = '');
        await page.evaluate(() => document.getElementById('statusCode').value = '');
        await page.evaluate(() => document.getElementById('body').value = '');
        await page.waitForSelector('#responseTime');
        await page.click('input[name=responseTime]');
        await page.type('input[name=responseTime]', '0');
        await page.waitForSelector('#statusCode');
        await page.click('input[name=statusCode]');
        await page.type('input[name=statusCode]', '200');
        await page.select('#responseType', 'html');
        await page.waitForSelector('#body');
        await page.click('textarea[name=body]');
        await page.type('textarea[name=body]', `<h1 id="html"><span>${bodyText}</span></h1>`);
        await page.click('button[type=submit]');
        await page.waitForSelector('#save-btn');
		
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#html > span');
        const html = await page.$eval('#html > span', (e) => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql(bodyText);
    }, 160000);
});
