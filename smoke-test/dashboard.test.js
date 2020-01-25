const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser, page;

let email = utils.generateRandomBusinessEmail();
let password = '1234567890';
const user = {
    email,
    password
};

describe('Monitor API', () => {
    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(150000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
        await init.registerUser(user, page);
        await init.loginUser(user, page);
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should create new monitor with correct details', async () => {
        let monitorName = utils.generateRandomString();
        await page.waitForSelector('#monitors');
        await page.click('#monitors');
        await page.waitForSelector('#frmNewMonitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await init.selectByText('#type', 'url', page);
        await page.waitForSelector('#url');
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(10000);
        let spanElement;
        spanElement = await page.$(`#monitor_title_${monitorName}`);
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(monitorName);
    }, operationTimeOut);

    it('Should not create new monitor when details that are incorrect', async () => {
        await page.waitFor(10000);
        await page.waitForSelector('#name');
        await init.selectByText('#type', 'url', page);
        await page.waitForSelector('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        let spanElement;
        spanElement = await page.$('#frmNewMonitor > div > div > div > fieldset > div > div > div > span >  div > div > span');
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly('This field cannot be left blank');
    }, operationTimeOut);
});