const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Project', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async () => {
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

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerEnterpriseUser(user, page);
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should not show upgrade/downgrade box if IS_SAAS_SERVICE is false',
        async () => {
            const email = utils.generateRandomBusinessEmail();
            const password = '1234567890';

            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await init.createUserFromAdminDashboard(
                    { email, password },
                    page
                );

                await page.$eval('#projects > a', elem => elem.click());
                await page.reload({ waitUntil: 'networkidle0' });

                const elem = await page.$$('table > tbody > tr');
                elem[0].click();

                await page.waitForNavigation({ waitUntil: 'networkidle0' });
                const planBox = await page.$('#planBox');
                expect(planBox).toBeNull();
            });
        },
        operationTimeOut
    );
});
