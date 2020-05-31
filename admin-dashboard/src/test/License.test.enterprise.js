const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const userEmail = utils.generateRandomBusinessEmail();
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Enterprise License API', () => {
    const operationTimeOut = 100000;

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
                email: data.userEmail,
                password: data.password,
            };
            // user
            await init.registerEnterpriseUser(user, page);
        });

        await cluster.queue({ email, password, userEmail });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async done => {
        done();
    });

    test(
        'Should not confirm expired license',
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

                await page.waitForSelector('#settings');
                await page.click('#settings');

                await page.waitForSelector('#license');
                await page.click('input[name=license]');
                await page.type('input[name=license]', 'expired-license');
                await page.click('input[name=email]');
                await page.type(
                    'input[name=email]',
                    utils.generateRandomBusinessEmail()
                );
                await page.click('button[type=submit]');
                await page.waitFor(20000);

                const expiredError = await page.$eval('#licenseError', e => {
                    return e.innerHTML;
                });

                expect(expiredError).toEqual('License Expired');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
