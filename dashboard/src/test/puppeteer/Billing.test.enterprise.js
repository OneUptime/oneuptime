const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Enterprise Disabled Billing API', () => {
    const operationTimeOut = 50000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });

        await cluster.queue({ email, password });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async done => {
        done();
    });

    test(
        'Should not display project billing page after login',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');

                const projectBilling = await page.$('#billing');
                expect(projectBilling).toBeNull();
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not display profile billing on profile menu',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');

                const profileBilling = await page.$('#profileBilling');
                expect(profileBilling).toBeNull();
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
