const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();

describe('Monitor Category', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(200000);

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
        await cluster.execute(async ({ page }) => {
            const user = {
                email,
                password,
            };

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            // Create Component first
            await init.addComponent(componentName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create a new monitor category',
        async () => {
            expect.assertions(1);

            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');

                await page.waitForSelector('li#monitors a');
                await page.click('li#monitors a');
                await page.waitForSelector('#createMonitorCategoryButton');
                await page.click('#createMonitorCategoryButton');
                await page.type(
                    '#monitorCategoryName',
                    utils.monitorCategoryName
                );
                await page.click('#addMonitorCategoryButton');

                const createdMonitorCategorySelector =
                    '#monitorCategoryList #monitor-category-name:nth-child(2)';

                await page.waitForSelector(createdMonitorCategorySelector);

                const createdMonitorCategoryName = await page.$eval(
                    createdMonitorCategorySelector,
                    el => el.textContent
                );

                expect(createdMonitorCategoryName).toEqual(
                    utils.monitorCategoryName
                );
            });
        },
        operationTimeOut
    );

    test(
        'should show created monitor category in new monitor dropdown',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#form-new-monitor');

                let monitorCategoryCheck = false;

                await init.selectByText(
                    '#monitorCategory',
                    utils.monitorCategoryName,
                    page
                );

                const noOption = await page.$('div.css-1gl4k7y');

                if (!noOption) {
                    monitorCategoryCheck = true;
                }
                expect(monitorCategoryCheck).toEqual(true);
            });
        },
        operationTimeOut
    );

    test(
        'should create a new monitor by selecting monitor category from dropdown',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', utils.monitorName);
                await init.selectByText(
                    '#monitorCategory',
                    utils.monitorCategoryName,
                    page
                );
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');
                await page.waitFor(5000);

                const createdMonitorSelector = `#monitor-title-${utils.monitorName}`;
                const createdMonitorName = await page.$eval(
                    createdMonitorSelector,
                    el => el.textContent
                );

                expect(createdMonitorName).toEqual(utils.monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'should delete the created monitor category',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');

                await page.waitForSelector('li#monitors a');
                await page.click('li#monitors a');

                const deleteButtonSelector =
                    '#deleteMonitorCategoryBtn > button';

                await page.waitForSelector(deleteButtonSelector);
                await page.click(deleteButtonSelector);
                await page.waitForSelector('#deleteMonitorCategory');
                await page.click('#deleteMonitorCategory');
                await page.waitFor(5000);

                const monitorCategoryCounterSelector = '#monitorCategoryCount';
                const monitorCategoryCount = await page.$eval(
                    monitorCategoryCounterSelector,
                    el => el.textContent
                );

                expect(monitorCategoryCount).toEqual('0 Monitor Category');
            });
        },
        operationTimeOut
    );
});
