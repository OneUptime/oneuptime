const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('SMTP Settings API', () => {
    const operationTimeOut = 100000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Admin should not turn on 2FA for a user',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('.bs-ObjectList-rows > a');
                const users = await page.$$('.bs-ObjectList-rows > a');
                await users[1].click();
                await page.waitFor(5000);
                await page.waitForSelector('#disableUser2fa');
                await page.click('#disableUser2fa');

                await page.waitForSelector('.bs-Modal-content > span');
                let info = await page.$('.bs-Modal-content > span');
                expect(info).toBeDefined();
                info = await info.getProperty('innerText');
                info = await info.jsonValue();
                expect(info).toEqual(
                    'Only the user can turn on 2FA not the admin'
                );
            });
        },
        operationTimeOut
    );
});
