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
            const componentName = utils.generateRandomString();
            const monitorName = utils.generateRandomString();
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await init.addMonitorToComponent(
                    componentName,
                    monitorName,
                    page
                );

                const monitorBreadcrumb = await page.waitForSelector(
                    `#cb${monitorName}`,
                    {
                        visible: true,
                    }
                );
                const componentBreadcrumb = await page.waitForSelector(
                    '#cbMonitors'
                );
                expect(monitorBreadcrumb).toBeDefined();
                expect(componentBreadcrumb).toBeDefined();
                await page.click('#cbMonitors');

                const monitorTitle = await page.waitForSelector(
                    `#monitor-title-${monitorName}`,
                    { visible: true }
                );
                expect(monitorTitle).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should not go to the landing page when the project breadcrumb item is clicked',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#cbUnnamedProject');
                await page.click('#cbUnnamedProject');
                let currentPage = await page.waitForSelector(
                    '#cbUnnamedProject'
                );
                currentPage = await currentPage.getProperty('innerText');
                currentPage = await currentPage.jsonValue();
                expect(currentPage).toBe('Unnamed Project');
            });
        },
        operationTimeOut
    );
});
