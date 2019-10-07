const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser, page, userCredentials;

let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};
let callSchedule = utils.generateRandomString();
let subProjectName = utils.generateRandomString();



describe('Monitor API', () => {
    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(150000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');

        // intercept request and mock response for login
        await page.setRequestInterception(true);
        await page.on('request', async (request) => {
            if ((await request.url()).match(/user\/login/)) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            } else {
                request.continue();
            }
        });
        await page.on('response', async (response) => {
            try {
                const res = await response.json();
                if (res && res.tokens) {
                    userCredentials = res;
                }
            } catch (error) { }
        });

        await init.registerUser(user, page);
        await init.loginUser(user, page);
        await init.addSchedule(callSchedule, page);

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
        await page.select('select[name=type_1000]', 'url');
        await page.waitForSelector('#url');
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        let spanElement;
        spanElement = await page.$('span.ContentHeader-title.Text-color--dark.Text-display--inline.Text-fontSize--20.Text-fontWeight--regular.Text-lineHeight--28.Text-typeface--base.Text-wrap--wrap');
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(monitorName);

    }, operationTimeOut);

    it('Should create new monitor with call schedule', async () => {
        let monitorName = utils.generateRandomString();
        await page.waitFor(10000);
        await page.waitForSelector('#name');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await page.select('select[name=type_1000]', 'url');
        await page.select('#callSchedule', callSchedule);
        await page.waitFor(2000);
        await page.waitForSelector('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        let spanElement;
        spanElement = await page.$('span.ContentHeader-title.Text-color--dark.Text-display--inline.Text-fontSize--20.Text-fontWeight--regular.Text-lineHeight--28.Text-typeface--base.Text-wrap--wrap');
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(monitorName);

    }, operationTimeOut);

    it('Should not create new monitor when details that are incorrect', async () => {

        await page.waitFor(10000);
        await page.waitForSelector('#name');
        await page.select('select[name=type_1000]', 'url');
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