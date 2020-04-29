const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('SSO API', () => {
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
        cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            await init.registerEnterpriseUser(user, page);
        });

        cluster.queue({ email, password });

        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should add new SSO',
        async (done) => {
            expect.assertions(1);
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
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
                await page.waitForSelector('#sso');
                await page.click('#sso');
                await page.waitForSelector('#add-sso');
                await page.click('#add-sso');
                await page.waitForSelector('#save-button');

                await page.click('#domain');
                await page.type('#domain', 'test.hackerbay.io');

                await page.click('#samlSsoUrl');
                await page.type('#samlSsoUrl', 'test.hackerbay.io/login');

                await page.click('#certificateFingerprint');
                await page.type('#certificateFingerprint', 'AZERTYUIOP');

                await page.click('#remoteLogoutUrl');
                await page.type('#remoteLogoutUrl', 'test.hackerbay.io/logout');

                await page.click('#ipRanges');
                await page.type('#ipRanges', '127.0.0.1');

                await page.click('#save-button');
                await page.waitFor(2000);

                const tbody = await page.$eval('tbody', e => {
                    return e.innerHTML;
                });
                expect(tbody).toContain('test.hackerbay.io');
            });

            cluster.queue({ email, password, });

            await cluster.idle();
            await cluster.close();
            done();
        }
    )
});
