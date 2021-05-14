const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
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

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should create new component',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#components', { timeout: 120000 });
            await init.pageClick(page, '#components');

            // Fill and submit New Component form
            await page.waitForSelector('#form-new-component');
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', componentName);
            await init.pageClick(page, '#addComponentButton');
            await page.waitForSelector('#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#components');

            let spanElement = await page.waitForSelector(
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
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#errorTracking');
            await init.pageClick(page, '#errorTracking');

            // Fill and submit New Error tracking form
            await page.waitForSelector('#form-new-error-tracker');
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', errorTrackerName);
            await init.pageClick(page, 'button[type=submit]');

            let spanElement = await page.waitForSelector(
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
    test(
        'Should create new resource category then redirect to error tracker page to create a error tracker under that',
        async done => {
            const categoryName = 'Random-Category';
            const newErrorTrackerName = `${errorTrackerName}-sample`;
            // create a new resource category
            await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(componentName, page);
            // go to logs
            await page.waitForSelector('#errorTracking');
            await init.pageClick(page, '#errorTracking');
            // create a new error tracker and select the category
            // Fill and submit New Error Tracker form
            await page.waitForSelector('#form-new-error-tracker');
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', newErrorTrackerName);
            await init.selectByText('#resourceCategory', categoryName, page);
            await init.pageClick(page, 'button[type=submit]');
            // As soon as an error tracker with a resource category is created, it automatically navigates to the details page

            // confirm the category shows in the details page.
            await page.waitForSelector(`#${newErrorTrackerName}-badge`, {
                visible: true,
                timeout: init.timeout,
            });
            let spanElement = await page.$(`#${newErrorTrackerName}-badge`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());
            done();
        },
        operationTimeOut
    );
    test(
        'Should not create new error tracker ',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#errorTracking');
            await init.pageClick(page, '#errorTracking');

            // Fill and submit New Error Tracker form
            await page.waitForSelector('#form-new-error-tracker');
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', '');
            await init.pageClick(page, 'button[type=submit]');

            await page.waitForSelector(
                '#form-new-error-tracker span#field-error',
                { visible: true, timeout: init.timeout }
            );
            let spanElement = await page.$(
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
        async done => {
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
            done();
        },
        operationTimeOut
    );
    test(
        'Should open edit created error tracker',
        async done => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            await page.waitForSelector(`#edit_${errorTrackerName}`);
            await init.pageClick(page, `#edit_${errorTrackerName}`);

            await page.waitForSelector(
                `#error-tracker-edit-title-${errorTrackerName}`,
                { visible: true, timeout: init.timeout }
            );
            let spanElement = await page.waitForSelector(
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
        async done => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // open modal
            await page.waitForSelector(`#key_${errorTrackerName}`);
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show applicaion log key
            await page.waitForSelector(
                `#show_error_tracker_key_${errorTrackerName}`
            );
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

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
        async done => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            await page.waitForSelector(`#key_${errorTrackerName}`);
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker  key
            await page.waitForSelector(
                `#show_error_tracker_key_${errorTrackerName}`
            );
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );
            let spanElement = await page.waitForSelector(
                `#error_tracker_key_${errorTrackerName}`
            );
            expect(spanElement).toBeDefined();

            // find the eye icon to hide error tracker key
            await page.waitForSelector(
                `#hide_error_tracker_key_${errorTrackerName}`
            );
            await init.pageClick(
                page,
                `#hide_error_tracker_key_${errorTrackerName}`
            );

            spanElement = await page.waitForSelector(
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
        async done => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            // open modal
            await page.waitForSelector(`#key_${errorTrackerName}`);
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker key
            await page.waitForSelector(
                `#show_error_tracker_key_${errorTrackerName}`
            );
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

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
            await init.pageClick(
                page,
                `#reset_error_tracker_key_${errorTrackerName}`
            );

            // click confirm reset key
            await page.waitForSelector(
                `#confirm_reset_error_tracker_key_${errorTrackerName}`
            );
            await init.pageClick(
                page,
                `#confirm_reset_error_tracker_key_${errorTrackerName}`
            );
            await page.waitForSelector(
                `#confirm_reset_error_tracker_key_${errorTrackerName}`,
                { hidden: true }
            );

            // open modal
            await page.waitForSelector(`#key_${errorTrackerName}`);
            await init.pageClick(page, `#key_${errorTrackerName}`);

            // click show error tracker key
            await page.waitForSelector(
                `#show_error_tracker_key_${errorTrackerName}`
            );
            await init.pageClick(
                page,
                `#show_error_tracker_key_${errorTrackerName}`
            );

            // get tracker container key
            spanElement = await page.waitForSelector(
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
        async done => {
            await init.navigateToErrorTrackerDetails(
                componentName,
                errorTrackerName,
                page
            );
            await page.waitForSelector(`#edit_${errorTrackerName}`);
            await init.pageClick(page, `#edit_${errorTrackerName}`);
            // Fill and submit edit Error tracker form
            await page.waitForSelector('#form-new-error-tracker');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', '-new');
            await init.pageClick(page, 'button[type=submit]');
            await page.waitForSelector('#addErrorTrackerButton', {
                hidden: true,
            });

            await page.waitForSelector('#errorTracking');
            await init.pageClick(page, '#errorTracking');
            let spanElement = await page.waitForSelector(
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
    test(
        'Should update category for created error tracker',
        async done => {
            const categoryName = 'Another-Category';
            // create a new resource category
            await init.addResourceCategory(categoryName, page);

            await init.navigateToErrorTrackerDetails(
                componentName,
                `${errorTrackerName}-new`,
                page
            );
            await page.waitForSelector(`#edit_${errorTrackerName}-new`);
            await init.pageClick(page, `#edit_${errorTrackerName}-new`);
            // Fill and submit edit Error tracker form
            await page.waitForSelector('#form-new-error-tracker');
            // change category here
            await init.selectByText('#resourceCategory', categoryName, page);
            await init.pageClick(page, 'button[type=submit]');
            await page.waitForSelector('#addErrorTrackerButton', {
                hidden: true,
            });

            await page.waitForSelector(`#${errorTrackerName}-new-badge`, {
                visible: true,
                timeout: init.timeout,
            });
            // confirm the new category shows in the details page.
            let spanElement = await page.$(`#${errorTrackerName}-new-badge`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());
            done();
        },
        operationTimeOut
    );
    test(
        'Should delete category for created log container and reflect',
        async done => {
            const categoryName = 'Another-Category';

            // confirm the error tracker has a category
            await init.navigateToErrorTrackerDetails(
                componentName,
                `${errorTrackerName}-new`,
                page
            );

            let spanElement = await page.$(`#${errorTrackerName}-new-badge`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());

            // delete the category
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');

            await page.waitForSelector('li#resources a');
            await init.pageClick(page, 'li#resources a');

            await page.waitForSelector(`#delete_${categoryName}`);
            await init.pageClick(page, `#delete_${categoryName}`);
            await page.waitForSelector('#deleteResourceCategory');
            await init.pageClick(page, '#deleteResourceCategory');

            await page.waitForSelector('#deleteResourceCategory', {
                hidden: true,
            });

            // go back to log details and confirm it is not there anymore
            const spanElementBadge = await page.$(
                `#${errorTrackerName}-new-badge`,
                { hidden: true }
            );
            expect(spanElementBadge).toBeNull();
            done();
        },
        operationTimeOut
    );
});
