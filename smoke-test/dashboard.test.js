const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Monitor API', () => {
    const operationTimeOut = 500000;

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();
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

        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
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
        'Should create new component',
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
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle2',
                });

                let spanElement = await page.waitForSelector(
                    `#component-title-${componentName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(componentName);
            });
        },
        operationTimeOut
    );

    it(
        'Should create new monitor with correct details',
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
                await page.waitFor(5000);

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
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    it(
        'Should not create new monitor when details that are incorrect',
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

                // Submit New Monitor form with incorrect details
                await page.waitForSelector('#name');
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement;
                spanElement = await page.waitForSelector(
                    '#form-new-monitor span#field-error'
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
});
