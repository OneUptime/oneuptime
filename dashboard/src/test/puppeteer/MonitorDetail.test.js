const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
let userCredentials;
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

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => {
                const signInResponse = userCredentials;

                if ((await request.url()).match(/user\/login/)) {
                    request.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(signInResponse)
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

    test('checkout page', async function () {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
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
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);

            await page.waitFor(5000);
            await page.screenshot({ path: 'screenshot-checkout.png' });
        });

        cluster.queue({ email, password, monitorName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);
});