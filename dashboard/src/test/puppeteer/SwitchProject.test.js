const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
let email = utils.generateRandomBusinessEmail();
let password = '1234567890';


describe('Project API', () => {
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

    test('Should create new project from dropdown after login', async (done) => {
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
            await page.waitForSelector('#selector');
            await page.$eval('#create-project', e => e.click());
            await page.waitFor(1000);
            await page.waitForSelector('#name');
            await page.click('input[id=name]');
            await page.type('input[id=name]', utils.generateRandomString());
            await page.click('input[id=Basic_Month]');
            await page.click('button[type=submit]');
            await page.waitFor(2000);
            localStorageData = await page.evaluate(() => {
                let json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });
            localStorageData.should.have.property('project');
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('Should switch project using project switcher', async (done) => {
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
            await page.waitForSelector('#AccountSwitcherId');
            await page.click('#AccountSwitcherId');
            await page.waitForSelector('#accountSwitcher');

            const element = await page.$('#accountSwitcher > div[title="Unnamed Project"]');
            
            await element.click();
            await page.waitFor(5000);
            localStorageData = await page.evaluate(() => {
                let json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });
            localStorageData.should.have.property('project');
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

});