const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

const admin = {
    email: 'masteradmin@hackerbay.io',
    password: '1234567890',
}
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Enterprise Team SubProject API', () => {
    const operationTimeOut = 500000;
    let cluster, cluster1;
    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });
        cluster1 = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: {
                args: [
                    '--incognito',
                ],
            },
            puppeteer,
            timeout: 500000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register users
        return await cluster.execute(null, async ({ page }) => {
            await init.registerEnterpriseUser(user, page);
            await init.adminLogout(page);
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        await cluster1.idle();
        await cluster1.close();
        done();
    });

    test(
        'should logout the user if the admin deletes the account from the dashboard.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                // Delete user from admin dashboard
                await cluster1.execute(null, async ({ page: pageInPrivateMode }) => {
                    await init.loginUser(admin, pageInPrivateMode);
                    await pageInPrivateMode.waitForSelector(
                        '.bs-ObjectList-rows>a:first-of-type'
                    );
                    await pageInPrivateMode.click('.bs-ObjectList-rows>a:first-of-type');
                    await pageInPrivateMode.waitForSelector('#delete');
                    await pageInPrivateMode.click('#delete');
                    await pageInPrivateMode.waitForSelector('#confirmDelete');
                    await pageInPrivateMode.click('#confirmDelete');
                    await pageInPrivateMode.waitFor(3000);
                });
                await page.waitForSelector('#statusPages');
                await page.click('#statusPages');
                await page.waitForSelector('#login-button');

            });
        },
        operationTimeOut
    );
});
