const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('BreadCrumb Component test', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };

            // user
            await init.registerUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should navigate between pages from the breadcrumbs',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                const user = {
                    email,
                    password,
                };
                await init.loginUser(user, page);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#monitors');
                await page.click('#monitors');
                let currentPage = await page.waitForSelector('#cbMonitors');
                currentPage = await currentPage.getProperty('innerText');
                currentPage = await currentPage.jsonValue();
                expect(currentPage).toBe('Monitors');

                await page.waitForSelector('#cbProjectSettings');
                await page.click('#cbProjectSettings');
                currentPage = await page.waitForSelector('#cbProjectSettings');
                currentPage = await currentPage.getProperty('innerText');
                currentPage = await currentPage.jsonValue();
                expect(currentPage).toBe('Project Settings');
            });
        },
        operationTimeOut
    );
});
