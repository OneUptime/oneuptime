const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const newComponentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const newMonitorName = utils.generateRandomString();

describe('Components', () => {
    const operationTimeOut = 50000;

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

        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should create new component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components');
                await page.click('#components');

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', componentName);
                await page.click('button[type=submit]');

                let spanElement;
                spanElement = await page.waitForSelector(
                    'span#component-content-header'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(componentName);
            });
        },
        operationTimeOut
    );

    test(
        'Should not create new component when details are incorrect',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components');
                await page.click('#components');

                // Fill and submit New Component form with incorrect details
                await page.waitForSelector('#form-new-component');
                await page.waitForSelector('#name');
                await page.click('button[type=submit]');

                let spanElement = await page.$(
                    '#form-new-component span#field-error'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'This field cannot be left blank'
                );
            });
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in a new component and get list of monitors',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // add new monitor to component on parent project
                await init.addMonitorToComponent(
                    newComponentName,
                    newMonitorName,
                    page
                );

                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components');
                await page.click('#components');

                const newComponentMonitorSelector =
                    '#component0 table > tbody > tr';
                await page.waitForSelector(newComponentMonitorSelector);

                const newMonitorRows = await page.$$(
                    newComponentMonitorSelector
                );
                const countNewMonitors = newMonitorRows.length;

                expect(countNewMonitors).toEqual(1);

                const componentMonitorSelector =
                    '#component1 table > tbody > tr';
                await page.waitForSelector(componentMonitorSelector);

                const monitorRows = await page.$$(componentMonitorSelector);
                const countMonitors = monitorRows.length;

                expect(countMonitors).toEqual(1);
            });
        },
        operationTimeOut
    );
});
