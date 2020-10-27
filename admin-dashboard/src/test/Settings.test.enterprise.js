const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

const masterAdmin = {
    email: 'masteradmin@hackerbay.io',
    password: '1234567890',
}

describe('Settings Component (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 1200000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute({ email: masterAdmin.email, password: masterAdmin.password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.loginUser(user, page, false);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show settings option in the admin dashboard',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                // if element does not exist it will timeout and throw
                const elem = await page.waitForSelector('#settings', {
                    visible: true,
                });
                expect(elem).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'should show license option in the admin dashboard',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#settings', { visible: true });
                await page.$eval('#settings a', elem => elem.click());
                await page.waitFor(3000)

                // if element does not exist it will timeout and throw
                const licenseOption = await page.waitForSelector('#license', {
                    visible: true,
                });
                expect(licenseOption).toBeDefined();
            });
        },
        operationTimeOut
    );
});
