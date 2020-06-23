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
const componentName = utils.generateRandomString();
const applicationLogName = utils.generateRandomString();
let applicationLogKey = '';

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
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#components', { timeout: 120000 });
                await page.click('#components');

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', componentName);
                await page.click('button[type=submit]');
                await page.goto(utils.DASHBOARD_URL);

                let spanElement;
                spanElement = await page.waitForSelector(
                    `span#component-title-${componentName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(componentName);
            });
        },
        operationTimeOut
    );
    test(
        'Should create new application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.click('#logs');

                // Fill and submit New Application  log form
                await page.waitForSelector('#form-new-application-log');
                await page.click('input[id=name]');
                await page.type('input[id=name]', applicationLogName);
                await page.click('button[type=submit]');
                //await page.goto(utils.DASHBOARD_URL);

                let spanElement;
                spanElement = await page.waitForSelector(
                    `span#application-log-title-${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(applicationLogName);
            });
        },
        operationTimeOut
    );
    test(
        'Should not create new application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.click('#logs');

                // Fill and submit New Application  log form
                await page.waitForSelector('#form-new-application-log');
                await page.click('input[id=name]');
                await page.type('input[id=name]', '');
                await page.click('button[type=submit]');

                let spanElement = await page.$(
                    '#form-new-application-log span#field-error'
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
        'Should open details page of created application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    applicationLogName,
                    page
                );

                let spanElement = await page.waitForSelector(
                    `#application-log-title-${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(applicationLogName);
            });
        },
        operationTimeOut
    );
    test(
        'Should open edit component for created application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    applicationLogName,
                    page
                );
                await page.waitForSelector(`#edit_${applicationLogName}`);
                await page.click(`#edit_${applicationLogName}`);

                let spanElement = await page.waitForSelector(
                    `#application-log-edit-title-${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    `Edit Log Container ${applicationLogName}`
                );
            });
        },
        operationTimeOut
    );
    test(
        'Should open application key for created application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    applicationLogName,
                    page
                );
                await page.waitForSelector(`#key_${applicationLogName}`);
                await page.click(`#key_${applicationLogName}`);
                await page.waitFor(1000);

                // get application log key
            });
        },
        operationTimeOut
    );
    test(
        'Should open application key for created application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    applicationLogName,
                    page
                );
                // open modal
                await page.waitForSelector(`#key_${applicationLogName}`);
                await page.click(`#key_${applicationLogName}`);

                // click show applicaion log key
                await page.waitForSelector(
                    `#show_application_log_key_${applicationLogName}`
                );
                await page.click(
                    `#show_application_log_key_${applicationLogName}`
                );
                await page.waitFor(2000);

                // get application log key
                let spanElement = await page.waitForSelector(
                    `#application_log_key_${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                applicationLogKey = await spanElement.jsonValue();

                // click cancel
                await page.waitForSelector(
                    `#cancel_application_log_key_${applicationLogName}`
                );
                await page.click(
                    `#cancel_application_log_key_${applicationLogName}`
                );
            });
        },
        operationTimeOut
    );
    test(
        'Should reset application key for created application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    applicationLogName,
                    page
                );
                // open modal
                await page.waitForSelector(`#key_${applicationLogName}`);
                await page.click(`#key_${applicationLogName}`);

                // click show applicaion log key
                await page.waitForSelector(
                    `#show_application_log_key_${applicationLogName}`
                );
                await page.click(
                    `#show_application_log_key_${applicationLogName}`
                );
                await page.waitFor(2000);

                // get application log key
                let spanElement = await page.waitForSelector(
                    `#application_log_key_${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                applicationLogKey = await spanElement.jsonValue();

                // click reset key
                await page.waitForSelector(
                    `#reset_application_log_key_${applicationLogName}`
                );
                await page.click(
                    `#reset_application_log_key_${applicationLogName}`
                );
                await page.waitFor(1000);

                // click confirm reset key
                await page.waitForSelector(
                    `#confirm_reset_application_log_key_${applicationLogName}`
                );
                await page.click(
                    `#confirm_reset_application_log_key_${applicationLogName}`
                );

                await page.waitFor(2000);
                // open modal
                await page.waitForSelector(`#key_${applicationLogName}`);
                await page.click(`#key_${applicationLogName}`);

                // click show applicaion log key
                await page.waitForSelector(
                    `#show_application_log_key_${applicationLogName}`
                );
                await page.click(
                    `#show_application_log_key_${applicationLogName}`
                );

                // get application log key
                spanElement = await page.waitForSelector(
                    `#application_log_key_${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                spanElement.should;
                spanElement.should.not.be.equal(applicationLogKey);
            });
        },
        operationTimeOut
    );
    test(
        'Should update name for created application log',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    applicationLogName,
                    page
                );
                await page.waitForSelector(`#edit_${applicationLogName}`);
                await page.click(`#edit_${applicationLogName}`);
                // Fill and submit edit Application  log form
                await page.waitForSelector('#form-new-application-log');
                await page.type('input[id=name]', '-new');
                await page.click('button[type=submit]');

                await page.click('#logs');

                let spanElement;
                spanElement = await page.waitForSelector(
                    `#application-log-title-${applicationLogName}-new`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(`${applicationLogName}-new`);
            });
        },
        operationTimeOut
    );
});
