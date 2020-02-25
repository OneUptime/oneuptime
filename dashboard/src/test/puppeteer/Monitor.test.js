const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
let email = utils.generateRandomBusinessEmail();
let password = '1234567890';
let callSchedule = utils.generateRandomString();

describe('Monitor API', () => {
    const operationTimeOut = 50000;

    beforeAll(async (done) => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        // Register user 
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            await init.addSchedule(data.callSchedule, page);
        });

        await cluster.queue({ email, password, callSchedule });

        await cluster.idle();
        await cluster.close();
        done();
    });
    
    afterAll(async (done) => {
        done();
    });

    test('Should create new monitor with correct details', async (done) => {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 100000
        });
        const monitorName = utils.generateRandomString();

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            
            await page.waitForSelector('#monitors');
            await page.click('#monitors');
            await page.waitForSelector('#frmNewMonitor');
            await page.click('input[id=name]');
            await page.type('input[id=name]', data.monitorName);
            await init.selectByText('#type', 'url', page);
            await page.waitForSelector('#url');
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');
            await page.waitFor(5000);

            let spanElement;

            spanElement = await page.$('span.ContentHeader-title.Text-color--dark.Text-display--inline.Text-fontSize--20.Text-fontWeight--regular.Text-lineHeight--28.Text-typeface--base.Text-wrap--wrap');
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(data.monitorName);
        });

        cluster.queue({ email, password, monitorName });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('Should create new monitor with call schedule', async (done) => {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 100000
        });
        const monitorName = utils.generateRandomString();

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            
            await page.waitFor(10000);
            await page.waitForSelector('#name');
            await page.click('input[id=name]');
            await page.type('input[id=name]', data.monitorName);
            await init.selectByText('#type', 'url', page);
            await init.selectByText('#callSchedule', data.callSchedule, page);
            await page.waitFor(2000);
            await page.waitForSelector('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');
            await page.waitFor(5000);

            let spanElement;

            spanElement = await page.$('span.ContentHeader-title.Text-color--dark.Text-display--inline.Text-fontSize--20.Text-fontWeight--regular.Text-lineHeight--28.Text-typeface--base.Text-wrap--wrap');
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(data.monitorName);
        });

        cluster.queue({ email, password, monitorName, callSchedule });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('Should not create new monitor when details that are incorrect', async (done) => {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 100000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
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
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);
});