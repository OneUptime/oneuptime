const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('About Modal (IS_SAAS_SERVICE=false)', () => {
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

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerEnterpriseUser(user, page, false);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show about option in admin dashboard profile menu',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                // if element does not exist it will timeout and throw
                await page.waitForSelector('#profile-menu', {
                    visible: true,
                });
                await page.$eval('#profile-menu', elem => elem.click());
                const about = await page.waitForSelector('#about-button', {
                    visible: true,
                });
                expect(about).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'should show about modal with app versions',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#profile-menu', {
                    visible: true,
                });
                await page.$eval('#profile-menu', elem => elem.click());
                await page.waitForSelector('#about-button', {
                    visible: true,
                });
                await page.$eval('#about-button', elem => elem.click());
                await page.waitForSelector('.bs-Modal', {
                    visible: true,
                });
                await page.waitForSelector('#server-version', {
                    visible: true,
                });
                const serverVersion = await page.$eval(
                    '#server-version',
                    elem => elem.textContent
                );
                const docsVersion = await page.$eval(
                    '#docs-version',
                    elem => elem.textContent
                );
                const helmVersion = await page.$eval(
                    '#helm-version',
                    elem => elem.textContent
                );
                const dashboardVersion = await page.$eval(
                    '#dashboard-version',
                    elem => elem.textContent
                );
                const adminDashboardVersion = await page.$eval(
                    '#admin-dashboard-version',
                    elem => elem.textContent
                );

                const probeVersion = await page.$eval(
                    '#probe-version',
                    elem => elem.textContent
                );

                expect(serverVersion).toBeDefined();
                expect(docsVersion).toBeDefined();
                expect(helmVersion).toBeDefined();
                expect(dashboardVersion).toBeDefined();
                expect(adminDashboardVersion).toBeDefined();
                expect(probeVersion).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'should close about modal',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#profile-menu', {
                    visible: true,
                });
                await page.$eval('#profile-menu', elem => elem.click());
                await page.waitForSelector('#about-button', {
                    visible: true,
                });
                await page.$eval('#about-button', elem => elem.click());
                await page.waitForSelector('.bs-Button', {
                    visible: true,
                });
                await page.click('.bs-Button');
            });
        },
        operationTimeOut
    );
});
