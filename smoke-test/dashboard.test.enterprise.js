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
            await init.loginUser(user, page);
        });

        // await cluster.queue({ email, password });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    it(
        'Should create new monitor with correct details',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL);

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', componentName);
                await page.click('button[type=submit]');

                // Navigate to details page of component created
                await page.waitForSelector(`#more-details-${componentName}`);
                await page.click(`#more-details-${componentName}`);
                await page.waitForSelector('#form-new-monitor');

                // Fill and submit New Monitor form
                await page.click('input[id=name]');
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
        'Should not create new monitor when details are incorrect',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL);

                // Navigate to details page of component created in previous test
                await page.waitForSelector(`#more-details-${componentName}`);
                await page.click(`#more-details-${componentName}`);
                await page.waitForSelector('#form-new-monitor');

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
