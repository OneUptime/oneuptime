const puppeteer = require('puppeteer');
const should = require('should');
const utils = require('./test-utils');

let browser;
let page;

describe('HTTP Settings page', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should return error if status code is not a valid staus code', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings', {
            waitUntil: 'networkidle2',
        });
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );
        await page.evaluate(() => (document.getElementById('body').value = ''));
        await page.waitForSelector('#responseTime');
        await page.click('input[name=responseTime]');
        await page.type('input[name=responseTime]', '0');
        await page.waitForSelector('#statusCode');
        await page.click('input[name=statusCode]');
        await page.type('input[name=statusCode]', '5');
        await page.select('#responseType', 'json');
        await page.waitForSelector('#body');
        await page.click('textarea[name=body]');
        await page.type('textarea[name=body]', 'HTTP test server go status');
        await page.click('button[type=submit]');
        await page.waitForSelector('#save-btn');

        await page.waitForSelector('#errorMsg > label > span');
        const html = await page.$eval('#errorMsg > label > span', e => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql('Please provide a valid status code');
    }, 160000);

    it('Should return error if response time is not a number', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings', {
            waitUntil: 'networkidle2',
        });
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );
        await page.evaluate(() => (document.getElementById('body').value = ''));
        await page.waitForSelector('#responseTime');
        await page.click('input[name=responseTime]');
        await page.type('input[name=responseTime]', 'not number');
        await page.waitForSelector('#statusCode');
        await page.click('input[name=statusCode]');
        await page.type('input[name=statusCode]', '500');
        await page.select('#responseType', 'json');
        await page.waitForSelector('#body');
        await page.click('textarea[name=body]');
        await page.type('textarea[name=body]', 'HTTP test server go status');
        await page.click('button[type=submit]');
        await page.waitForSelector('#save-btn');

        await page.waitForSelector('#errorMsg > label > span');
        const html = await page.$eval('#errorMsg > label > span', e => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql('Response Time should be a number');
    }, 160000);

    it('Should return error if server status is not a number', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings', {
            waitUntil: 'networkidle2',
        });
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );
        await page.evaluate(() => (document.getElementById('body').value = ''));
        await page.waitForSelector('#responseTime');
        await page.click('input[name=responseTime]');
        await page.type('input[name=responseTime]', '0');
        await page.waitForSelector('#statusCode');
        await page.click('input[name=statusCode]');
        await page.type('input[name=statusCode]', 'not a number');
        await page.select('#responseType', 'json');
        await page.waitForSelector('#body');
        await page.click('textarea[name=body]');
        await page.type('textarea[name=body]', 'HTTP test server go status');
        await page.click('button[type=submit]');
        await page.waitForSelector('#save-btn');

        await page.waitForSelector('#errorMsg > label > span');
        const html = await page.$eval('#errorMsg > label > span', e => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql('Status code should be a number');
    }, 160000);

    it('Should return', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings', {
            waitUntil: 'networkidle2',
        });
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );
        await page.evaluate(() => (document.getElementById('body').value = ''));
        await page.waitForSelector('#responseTime');
        await page.click('input[name=responseTime]');
        await page.type('input[name=responseTime]', '0');
        await page.waitForSelector('#statusCode');
        await page.click('input[name=statusCode]');
        await page.type('input[name=statusCode]', '200');
        await page.select('#responseType', 'html');
        await page.waitForSelector('#body');
        await page.click('textarea[name=body]');
        await page.type(
            'textarea[name=body]',
            '<h1 id="html"><span>HTTP test case.</span></h1>'
        );
        await page.click('button[type=submit]');
        await page.waitForSelector('#save-btn');

        await page.goto(utils.HTTP_TEST_SERVER_URL + '/', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#html > span');
        const html = await page.$eval('#html > span', e => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql('');
    }, 160000);
});
