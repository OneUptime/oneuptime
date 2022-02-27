// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const errorTrackerName = utils.generateRandomString();
let errorTrackerKey = '';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Error Trackers', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create new component',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.pageWaitForSelector(page, '#components', {
                timeout: 120000,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            // Fill and submit New Component form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-component');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', componentName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addComponentButton');
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `span#component-title-${componentName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(componentName);
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create new error tracker container',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#errorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#errorTracking');

            // Fill and submit New Error tracking form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', errorTrackerName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `span#error-tracker-title-${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            const title = `${errorTrackerName} (0)`;
            spanElement.should.be.exactly(title);
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test.skip(
        'Should create new resource category then redirect to error tracker page to create a error tracker under that',
        async (done: $TSFixMe) => {
            const categoryName = 'Random-Category';
            const newErrorTrackerName = `${errorTrackerName}-sample`;
            // create a new resource category
            await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(componentName, page);
            // go to logs
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#errorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#errorTracking');
            // create a new error tracker and select the category
            // Fill and submit New Error Tracker form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbErrorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#newFormId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', newErrorTrackerName);
            await init.selectDropdownValue(
                '#resourceCategory',
                categoryName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // As soon as an error tracker with a resource category is created, it automatically navigates to the details page

            // confirm the category shows in the details page.
            await init.pageWaitForSelector(
                page,
                `#${newErrorTrackerName}-badge`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.page$(
                page,
                `#${newErrorTrackerName}-badge`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not create new error tracker ',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#errorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#errorTracking');

            // Fill and submit New Error Tracker form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbErrorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#newFormId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', '');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(
                page,
                '#form-new-error-tracker span#field-error',
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.page$(
                page,
                '#form-new-error-tracker span#field-error'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('This field cannot be left blank');
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should open details page of created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#error-tracker-title-${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            const title = `${errorTrackerName} (0)`;
            spanElement.should.be.exactly(title);
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should open edit created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#edit_${errorTrackerName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#edit_${errorTrackerName}`);

            await init.pageWaitForSelector(
                page,
                `#error-tracker-edit-title-${errorTrackerName}`,
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#error-tracker-edit-title-${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(`Edit Tracker ${errorTrackerName}`);
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should open tracker key for created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // open modal
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show applicaion log key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get error tracker key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            errorTrackerKey = await spanElement.jsonValue();
            expect(spanElement).toBeDefined();

            // click cancel
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#cancel_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#cancel_error_tracker_key_${errorTrackerName}`
            );
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should open tracker key for created error tracker container and hide it back',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker  key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            expect(spanElement).toBeDefined();

            // find the eye icon to hide error tracker key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#hide_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#hide_error_tracker_key_${errorTrackerName}`
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            spanElement = await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toEqual('Click here to reveal Tracker API key');
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should reset tracker key for created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // open modal
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get error tracker key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            errorTrackerKey = await spanElement.jsonValue();

            // click reset key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#reset_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#reset_error_tracker_key_${errorTrackerName}`
            );

            // click confirm reset key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#confirm_reset_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#confirm_reset_error_tracker_key_${errorTrackerName}`
            );
            await init.pageWaitForSelector(
                page,
                `#confirm_reset_error_tracker_key_${errorTrackerName}`,
                { hidden: true }
            );

            // open modal
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get tracker container key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toBeDefined();
            spanElement.should.not.be.equal(errorTrackerKey);
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should update name for created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#edit_${errorTrackerName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#edit_${errorTrackerName}`);
            // Fill and submit edit Error tracker form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', '-new');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#addErrorTrackerButton', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#errorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#errorTracking');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#error-tracker-title-${errorTrackerName}-new`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            const title = `${errorTrackerName}-new (0)`;
            spanElement.should.be.exactly(title);
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test.skip(
        'Should update category for created error tracker',
        async (done: $TSFixMe) => {
            const categoryName = 'Another-Category';
            // create a new resource category
            await init.addResourceCategory(categoryName, page);

            await init.navigateToErrorTrackerDetails(
                componentName,
                `${errorTrackerName}-new`,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#edit_${errorTrackerName}-new`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#edit_${errorTrackerName}-new`);
            // Fill and submit edit Error tracker form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            // change category here
            await init.selectDropdownValue(
                '#resourceCategory',
                categoryName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#addErrorTrackerButton', {
                hidden: true,
            });

            await init.pageWaitForSelector(
                page,
                `#${errorTrackerName}-new-badge`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // confirm the new category shows in the details page.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.page$(
                page,
                `#${errorTrackerName}-new-badge`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test.skip(
        'Should delete category for created log container and reflect',
        async (done: $TSFixMe) => {
            const categoryName = 'Another-Category';

            // confirm the error tracker has a category
            await init.navigateToErrorTrackerDetails(
                componentName,
                `${errorTrackerName}-new`,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.page$(
                page,
                `#${errorTrackerName}-new-badge`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());

            // delete the category
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'li#resources a');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'li#resources a');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#delete_${categoryName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#delete_${categoryName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteResourceCategory');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteResourceCategory');

            await init.pageWaitForSelector(page, '#deleteResourceCategory', {
                hidden: true,
            });

            // go back to log details and confirm it is not there anymore
            await init.navigateToErrorTrackerDetails(
                componentName,
                `${errorTrackerName}-new`,
                page
            );

            const spanElementBadge = await init.pageWaitForSelector(
                page,
                `#${errorTrackerName}-new-badge`,
                { hidden: true }
            );
            expect(spanElementBadge).toBeNull();
            done();
        },
        operationTimeOut
    );
});
