const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('User logout', () => {
    const operationTimeOut = 500000;
    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register users
        return await cluster.execute(null, async ({ page }) => {
            await init.registerEnterpriseUser(user, page);
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Admin should be able to logout from dashboard (not admin-dashboard)',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForTimeout('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForTimeout('#logout-button');
                await Promise.all([
                    page.click('#logout-button'),
                    page.waitForNavigation({ waitUntil: 'networkidle2' }),
                ]);

                await Promise.all([
                    page.goto(utils.ADMIN_DASHBOARD_URL),
                    page.waitForNavigation({ waitUntil: 'networkidle2' }),
                ]);
                expect(page.url()).toEqual(
                    `${utils.ACCOUNTS_URL}/accounts/login`
                );
            });
        },
        operationTimeOut
    );
});
