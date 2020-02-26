const puppeteer = require('puppeteer');
var utils = require('./test-utils');
var should = require('should');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
let email = utils.generateRandomBusinessEmail();
let password = '1234567890';

describe('Monitor Category', () => {
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
        });

        await cluster.queue({ email, password });

        await cluster.idle();
        await cluster.close();
        done();
    });
    
    afterAll(async (done) => {
        done();
    });

    test('should create a new monitor category', async (done) => {
        expect.assertions(1);

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
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#monitors:nth-of-type(2)');
            await page.click('#monitors:nth-of-type(2)');
            await page.waitForSelector('#createMonitorCategoryButton');
            await page.click('#createMonitorCategoryButton');
            await page.type('#monitorCategoryName', utils.monitorCategoryName);
            await page.click('#addMonitorCategoryButton');
            await page.waitFor(5000);

            var createdMonitorCategorySelector = '#monitorCategoryList #monitor-category-name:nth-child(2)'
            var createdMonitorCategoryName = await page.$eval(createdMonitorCategorySelector, el => el.textContent);

            expect(createdMonitorCategoryName).toEqual(utils.monitorCategoryName);
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should show created monitor category in new monitor dropdown', async (done) => {
        expect.assertions(1);
        
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

            let monitorCategoryCheck = false;

            await init.selectByText('#monitorCategory', utils.monitorCategoryName, page);
            
            let noOption = await page.$('div.css-1gl4k7y');

            if (!noOption) {
                monitorCategoryCheck = true;
            }
            expect(monitorCategoryCheck).toEqual(true);
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should create a new monitor by selecting monitor category from dropdown', async (done) => {
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
            await page.waitForSelector('#frmNewMonitor');
            await page.click('input[id=name]');
            await page.type('input[id=name]', utils.monitorName);
            await init.selectByText('#monitorCategory', utils.monitorCategoryName, page);
            await init.selectByText('#type', 'url', page);
            await page.waitForSelector('#url');
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');
            await page.waitFor(5000);

            var createdMonitorSelector = `#monitor_title_${utils.monitorName}`
            var createdMonitorName = await page.$eval(createdMonitorSelector, el => el.textContent);

            expect(createdMonitorName).toEqual(utils.monitorName);
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should delete the created monitor category', async (done) => {
        expect.assertions(1);
        
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
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#monitors:nth-of-type(2)');
            await page.click('#monitors:nth-of-type(2)');

            var deleteButtonSelector = '#deleteMonitorCategoryBtn > button'
            
            await page.waitForSelector(deleteButtonSelector);
            await page.click(deleteButtonSelector);
            await page.waitForSelector('#deleteMonitorCategory');
            await page.click('#deleteMonitorCategory');
            await page.waitFor(5000);

            var monitorCategoryCounterSelector = '#monitorCategoryCount'
            var monitorCategoryCount = await page.$eval(monitorCategoryCounterSelector, el => el.textContent);

            expect(monitorCategoryCount).toEqual("0 Monitor Category");
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);
});
