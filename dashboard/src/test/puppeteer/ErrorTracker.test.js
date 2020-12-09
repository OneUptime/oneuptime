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
const errorTrackerName = utils.generateRandomString();
let errorTrackerKey = '';

describe('Error Trackers', () => {
    const operationTimeOut = 900000;

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

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
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
                await page.click('#addComponentButton');
                await page.waitForSelector('#form-new-monitor', {
                    visible: true,
                });
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                let spanElement = await page.waitForSelector(
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
        'Should create new error tracker container',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#errorTracking');
                await page.click('#errorTracking');

                // Fill and submit New Error tracking form
                await page.waitForSelector('#form-new-error-tracker');
                await page.click('input[id=name]');
                await page.type('input[id=name]', errorTrackerName);
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `span#error-tracker-title-${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                const title = `${errorTrackerName} (0)`;
                spanElement.should.be.exactly(title);
            });
        },
        operationTimeOut
    );
    test(
        'Should create new resource category then redirect to error tracker page to create a error tracker under that',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                const categoryName = 'Random-Category';
                const newErrorTrackerName = `${errorTrackerName}-sample`;
                // create a new resource category
                await init.addResourceCategory(categoryName, page);
                //navigate to component details
                await init.navigateToComponentDetails(componentName, page);
                // go to logs
                await page.waitForSelector('#errorTracking');
                await page.click('#errorTracking');
                // create a new error tracker and select the category
                // Fill and submit New Error Tracker form
                await page.waitForSelector('#form-new-error-tracker');
                await page.click('input[id=name]');
                await page.type('input[id=name]', newErrorTrackerName);
                await init.selectByText(
                    '#resourceCategory',
                    categoryName,
                    page
                );
                await page.click('button[type=submit]');
                // goto the details page
                await page.waitForSelector(
                    `#more-details-${newErrorTrackerName}`
                );
                await page.click(`#more-details-${newErrorTrackerName}`);
                // confirm the category shows in the details page.
                await page.waitForSelector(`#${newErrorTrackerName}-badge`, {
                    visible: true,
                });
                let spanElement = await page.$(`#${newErrorTrackerName}-badge`);
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(categoryName.toUpperCase());
            });
        },
        operationTimeOut
    );
    test(
        'Should not create new error tracker ',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#errorTracking');
                await page.click('#errorTracking');

                // Fill and submit New Error Tracker form
                await page.waitForSelector('#form-new-error-tracker');
                await page.click('input[id=name]');
                await page.type('input[id=name]', '');
                await page.click('button[type=submit]');

                await page.waitForSelector(
                    '#form-new-error-tracker span#field-error',
                    { visible: true }
                );
                let spanElement = await page.$(
                    '#form-new-error-tracker span#field-error'
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
        'Should open details page of created error tracker',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToErrorTrackerDetails(
                    componentName,
                    errorTrackerName,
                    page
                );

                let spanElement = await page.waitForSelector(
                    `#error-tracker-title-${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                const title = `${errorTrackerName} (0)`;
                spanElement.should.be.exactly(title);
            });
        },
        operationTimeOut
    );
    test(
        'Should open edit created error tracker',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToErrorTrackerDetails(
                    componentName,
                    errorTrackerName,
                    page
                );
                await page.waitForSelector(`#edit_${errorTrackerName}`);
                await page.click(`#edit_${errorTrackerName}`);

                let spanElement = await page.waitForSelector(
                    `#error-tracker-edit-title-${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    `Edit Tracker ${errorTrackerName}`
                );
            });
        },
        operationTimeOut
    );
    test(
        'Should open tracker key for created error tracker',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToErrorTrackerDetails(
                    componentName,
                    errorTrackerName,
                    page
                );
                // open modal
                await page.waitForSelector(`#key_${errorTrackerName}`);
                await page.click(`#key_${errorTrackerName}`);

                // click show applicaion log key
                await page.waitForSelector(
                    `#show_error_tracker_key_${errorTrackerName}`
                );
                await page.click(`#show_error_tracker_key_${errorTrackerName}`);

                // get error tracker key
                let spanElement = await page.waitForSelector(
                    `#error_tracker_key_${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                errorTrackerKey = await spanElement.jsonValue();
                expect(spanElement).toBeDefined();

                // click cancel
                await page.waitForSelector(
                    `#cancel_error_tracker_key_${errorTrackerName}`
                );
                await page.click(
                    `#cancel_error_tracker_key_${errorTrackerName}`
                );
            });
        },
        operationTimeOut
    );
    test(
        'Should open tracker key for created error tracker container and hide it back',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToErrorTrackerDetails(
                    componentName,
                    errorTrackerName,
                    page
                );
                await page.waitForSelector(`#key_${errorTrackerName}`);
                await page.click(`#key_${errorTrackerName}`);

                // click show error tracker  key
                await page.waitForSelector(
                    `#show_error_tracker_key_${errorTrackerName}`
                );
                await page.click(`#show_error_tracker_key_${errorTrackerName}`);
                let spanElement = await page.waitForSelector(
                    `#error_tracker_key_${errorTrackerName}`
                );
                expect(spanElement).toBeDefined();

                // find the eye icon to hide error tracker key
                await page.waitForSelector(
                    `#hide_error_tracker_key_${errorTrackerName}`
                );
                await page.click(`#hide_error_tracker_key_${errorTrackerName}`);

                spanElement = await page.waitForSelector(
                    `#show_error_tracker_key_${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                expect(spanElement).toEqual(
                    'Click here to reveal Tracker API key'
                );
            });
        },
        operationTimeOut
    );
    test(
        'Should reset tracker key for created errir tracker',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToApplicationLogDetails(
                    componentName,
                    errorTrackerName,
                    page
                );
                // open modal
                await page.waitForSelector(`#key_${errorTrackerName}`);
                await page.click(`#key_${errorTrackerName}`);

                // click show error tracker key
                await page.waitForSelector(
                    `#show_error_tracker_key_${errorTrackerName}`
                );
                await page.click(`#show_error_tracker_key_${errorTrackerName}`);

                // get error tracker key
                let spanElement = await page.waitForSelector(
                    `#error_tracker_key_${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                errorTrackerKey = await spanElement.jsonValue();

                // click reset key
                await page.waitForSelector(
                    `#reset_error_tracker_key_${errorTrackerName}`
                );
                await page.click(
                    `#reset_error_tracker_key_${errorTrackerName}`
                );

                // click confirm reset key
                await page.waitForSelector(
                    `#confirm_reset_error_tracker_key_${errorTrackerName}`
                );
                await page.click(
                    `#confirm_reset_error_tracker_key_${errorTrackerName}`
                );
                await page.waitForSelector(
                    `#confirm_reset_error_tracker_key_${errorTrackerName}`,
                    { hidden: true }
                );

                // open modal
                await page.waitForSelector(`#key_${errorTrackerName}`);
                await page.click(`#key_${errorTrackerName}`);

                // click show error tracker key
                await page.waitForSelector(
                    `#show_error_tracker_key_${errorTrackerName}`
                );
                await page.click(`#show_error_tracker_key_${errorTrackerName}`);

                // get tracker container key
                spanElement = await page.waitForSelector(
                    `#error_tracker_key_${errorTrackerName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                expect(spanElement).toBeDefined();
                spanElement.should.not.be.equal(errorTrackerKey);
            });
        },
        operationTimeOut
    );
});
