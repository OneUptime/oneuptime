const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

const admin = {
    email: 'masteradmin@hackerbay.io',
    password: '1234567890',
};
// user credentials
const user = {
    email: `test${utils.generateRandomBusinessEmail()}`,
    password: '1234567890',
};

describe('Users', () => {
    const operationTimeOut = 500000;
    let cluster, browser, browserPage;
    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });

        browser = await puppeteer.launch({
            ...utils.puppeteerLaunchConfig,
        });
        browserPage = await browser.newPage();

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
        await browser.close();
        done();
    });

    it(
        'should logout the user if the admin deletes the account from the dashboard.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                await browserPage.bringToFront();
                await init.loginUser(admin, browserPage);
                await browserPage.waitForSelector(
                    `#${user.email.split('@')[0]}`,
                    { visible: true }
                );
                await browserPage.click(`#${user.email.split('@')[0]}`);
                await browserPage.waitForSelector('#delete', { visible: true });
                await browserPage.waitForTimeout(1000);
                await browserPage.click('#delete');
                await browserPage.waitForSelector('#confirmDelete', {
                    visible: true,
                });
                await browserPage.click('#confirmDelete');
                await browserPage.waitForSelector('#confirmDelete', {
                    hidden: true,
                });

                await page.bringToFront();
                await page.waitForSelector('#statusPages');
                await page.click('#statusPages');
                await page.waitForSelector('#login-button', { visible: true });
            });
        },
        operationTimeOut
    );

    it(
        'should be able to restore deleted users (using admin account)',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(admin, page);
                await page.waitForSelector(
                    `#deleted__${user.email.split('@')[0]}`,
                    { visible: true }
                );
                await page.click(`#deleted__${user.email.split('@')[0]}`);
                await page.waitForTimeout(1000);
                await page.waitForSelector('#restore', { visible: true });
                await page.click('#restore');
                const delBtn = await page.waitForSelector('#delete', {
                    visible: true,
                });
                expect(delBtn).toBeDefined();
            });
        },
        operationTimeOut
    );
});
