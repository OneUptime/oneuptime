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

describe('Error Trackers', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

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

            await init.pageClick(page, '#components');

            // Fill and submit New Component form

            await init.pageWaitForSelector(page, '#form-new-component');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', componentName);

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

            await init.pageClick(page, '#components');

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

    test(
        'Should create new error tracker container',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#errorTracking');

            await init.pageClick(page, '#errorTracking');

            // Fill and submit New Error tracking form

            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', errorTrackerName);

            await init.pageClick(page, 'button[type=submit]');

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

            await init.pageWaitForSelector(page, '#errorTracking');

            await init.pageClick(page, '#errorTracking');
            // create a new error tracker and select the category
            // Fill and submit New Error Tracker form

            await init.pageWaitForSelector(page, '#cbErrorTracking');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', newErrorTrackerName);
            await init.selectDropdownValue(
                '#resourceCategory',
                categoryName,
                page
            );

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

    test(
        'Should not create new error tracker ',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#errorTracking');

            await init.pageClick(page, '#errorTracking');

            // Fill and submit New Error Tracker form

            await init.pageWaitForSelector(page, '#cbErrorTracking');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', '');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(
                page,
                '#form-new-error-tracker span#field-error',
                { visible: true, timeout: init.timeout }
            );

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

    test(
        'Should open details page of created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );

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

    test(
        'Should open edit created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );

            await init.pageWaitForSelector(page, `#edit_${errorTrackerName}`);

            await init.pageClick(page, `#edit_${errorTrackerName}`);

            await init.pageWaitForSelector(
                page,
                `#error-tracker-edit-title-${errorTrackerName}`,
                { visible: true, timeout: init.timeout }
            );

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

    test(
        'Should open tracker key for created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // open modal

            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);

            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show applicaion log key

            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get error tracker key

            let spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            errorTrackerKey = await spanElement.jsonValue();
            expect(spanElement).toBeDefined();

            // click cancel

            await init.pageWaitForSelector(
                page,
                `#cancel_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#cancel_error_tracker_key_${errorTrackerName}`
            );
            done();
        },
        operationTimeOut
    );

    test(
        'Should open tracker key for created error tracker container and hide it back',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );

            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);

            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker  key

            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            let spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            expect(spanElement).toBeDefined();

            // find the eye icon to hide error tracker key

            await init.pageWaitForSelector(
                page,
                `#hide_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#hide_error_tracker_key_${errorTrackerName}`
            );

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

    test(
        'Should reset tracker key for created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // open modal

            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);

            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker key

            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get error tracker key

            let spanElement = await init.pageWaitForSelector(
                page,
                `#error_tracker_key_${errorTrackerName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            errorTrackerKey = await spanElement.jsonValue();

            // click reset key

            await init.pageWaitForSelector(
                page,
                `#reset_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#reset_error_tracker_key_${errorTrackerName}`
            );

            // click confirm reset key

            await init.pageWaitForSelector(
                page,
                `#confirm_reset_error_tracker_key_${errorTrackerName}`
            );

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

            await init.pageWaitForSelector(page, `#key_${errorTrackerName}`);

            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker key

            await init.pageWaitForSelector(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get tracker container key

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

    test(
        'Should update name for created error tracker',
        async (done: $TSFixMe) => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );

            await init.pageWaitForSelector(page, `#edit_${errorTrackerName}`);

            await init.pageClick(page, `#edit_${errorTrackerName}`);
            // Fill and submit edit Error tracker form

            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', '-new');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#addErrorTrackerButton', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, '#errorTracking');

            await init.pageClick(page, '#errorTracking');

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

            await init.pageWaitForSelector(
                page,
                `#edit_${errorTrackerName}-new`
            );

            await init.pageClick(page, `#edit_${errorTrackerName}-new`);
            // Fill and submit edit Error tracker form

            await init.pageWaitForSelector(page, '#form-new-error-tracker');
            // change category here
            await init.selectDropdownValue(
                '#resourceCategory',
                categoryName,
                page
            );

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

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, 'li#resources a');

            await init.pageClick(page, 'li#resources a');

            await init.pageWaitForSelector(page, `#delete_${categoryName}`);

            await init.pageClick(page, `#delete_${categoryName}`);

            await init.pageWaitForSelector(page, '#deleteResourceCategory');

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
