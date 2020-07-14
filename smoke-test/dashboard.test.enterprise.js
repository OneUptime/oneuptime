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

describe('Enterprise Dashboard API', () => {
    const operationTimeOut = 100000;
    let cluster;
    const monitorName = utils.generateRandomString();
    const componentName = utils.generateRandomString();

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

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            // user
            await init.registerEnterpriseUser(user, page);
            await init.logout(page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.execute(null, async ({ page }) => {
            // delete monitor
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector(`#more-details-${componentName}`);
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector(`#more-details-${monitorName}`);
            await page.click(`#more-details-${monitorName}`);
            await page.waitForSelector(`#delete_${monitorName}`);
            await page.click(`#delete_${monitorName}`);
            await page.waitForSelector('#deleteMonitor');
            await page.click('#deleteMonitor');
            await page.waitFor(2000);

            // delete component
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector(`#delete-component-${componentName}`);
            await page.click(`#delete-component-${componentName}`);
            await page.waitForSelector('#deleteComponent');
            await page.click('#deleteComponent');
            await page.waitFor(2000);
        });
        await cluster.idle();
        await cluster.close();
    });

    it(
        'Should create new monitor with correct details',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle2',
                });

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', componentName);
                await page.click('button[type=submit]');
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                // Fill and submit New Monitor form
                await page.click('input[id=name]', { visible: true });
                await page.type('input[id=name]', monitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement;
                spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`,
                    { visible: true }
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    it(
        'Should not create new monitor when details are incorrect',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle2',
                });

                // Navigate to details page of component created in previous test
                await page.waitForSelector(`#more-details-${componentName}`);
                await page.click(`#more-details-${componentName}`);
                await page.waitForSelector('#form-new-monitor', {
                    visible: true,
                });

                // Fill and submit New Monitor form
                await page.click('input[id=name]');
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement;
                spanElement = await page.$('#field-error');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'This field cannot be left blank'
                );
            });
        },
        operationTimeOut
    );
});
