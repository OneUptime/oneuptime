import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const applicationLogName = utils.generateRandomString();
let applicationLogKey = '';

describe('Log Containers', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        await init.addComponent(componentName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should create new log container and confirm that it redirects to the details page',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClickNavigate(page, '#logs');

            // Fill and submit New Application  log form

            await init.pageWaitForSelector(page, '#form-new-application-log');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', applicationLogName);

            await init.pageClickNavigate(page, 'button[type=submit]');

            let spanElement = await init.pageWaitForSelector(
                page,
                `span#application-log-title-${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(applicationLogName);

            // find the log api key button which appears only on the details page

            const logKeyElement = await init.pageWaitForSelector(
                page,
                `#key_${applicationLogName}`
            );
            expect(logKeyElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should open edit component for created log container',
        async (done: $TSFixMe) => {
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );

            await init.pageWaitForSelector(page, `#edit_${applicationLogName}`);

            await init.pageClick(page, `#edit_${applicationLogName}`);

            let spanElement = await init.pageWaitForSelector(
                page,
                `#application-log-edit-title-${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(
                `Edit Log Container ${applicationLogName}`
            );

            done();
        },
        operationTimeOut
    );

    test(
        'Should open application key for created log container',
        async (done: $TSFixMe) => {
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );
            // open modal

            await init.pageWaitForSelector(page, `#key_${applicationLogName}`);

            await init.pageClick(page, `#key_${applicationLogName}`);

            // click show applicaion log key

            await init.pageWaitForSelector(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            // get log container key

            let spanElement = await init.pageWaitForSelector(
                page,
                `#application_log_key_${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            applicationLogKey = await spanElement.jsonValue();
            expect(spanElement).toBeDefined();

            // click cancel

            await init.pageWaitForSelector(
                page,
                `#cancel_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#cancel_application_log_key_${applicationLogName}`
            );

            done();
        },
        operationTimeOut
    );

    test(
        'Should open application key for created log container and hide it back',
        async (done: $TSFixMe) => {
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );

            await init.pageWaitForSelector(page, `#key_${applicationLogName}`);

            await init.pageClick(page, `#key_${applicationLogName}`);

            // click show applicaion log key

            await init.pageWaitForSelector(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            let spanElement = await init.pageWaitForSelector(
                page,
                `#application_log_key_${applicationLogName}`
            );
            expect(spanElement).toBeDefined();

            // find the eye icon to hide log container key

            await init.pageWaitForSelector(
                page,
                `#hide_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#hide_application_log_key_${applicationLogName}`
            );

            spanElement = await init.pageWaitForSelector(
                page,
                `#show_application_log_key_${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toEqual('Click here to reveal Log API key');

            done();
        },
        operationTimeOut
    );

    test(
        'Should reset application key for created log container',
        async (done: $TSFixMe) => {
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );
            // open modal

            await init.pageWaitForSelector(page, `#key_${applicationLogName}`);

            await init.pageClick(page, `#key_${applicationLogName}`);

            // click show applicaion log key

            await init.pageWaitForSelector(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            // get log container key

            let spanElement = await init.pageWaitForSelector(
                page,
                `#application_log_key_${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            applicationLogKey = await spanElement.jsonValue();

            // click reset key

            await init.pageWaitForSelector(
                page,
                `#reset_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#reset_application_log_key_${applicationLogName}`
            );

            // click confirm reset key

            await init.pageWaitForSelector(
                page,
                `#confirm_reset_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#confirm_reset_application_log_key_${applicationLogName}`
            );
            await init.pageWaitForSelector(
                page,
                `#confirm_reset_application_log_key_${applicationLogName}`,
                { hidden: true }
            );

            // open modal

            await init.pageWaitForSelector(page, `#key_${applicationLogName}`);

            await init.pageClick(page, `#key_${applicationLogName}`);

            // click show applicaion log key

            await init.pageWaitForSelector(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            await init.pageClick(
                page,
                `#show_application_log_key_${applicationLogName}`
            );

            // get log container key

            spanElement = await init.pageWaitForSelector(
                page,
                `#application_log_key_${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toBeDefined();
            spanElement.should.not.be.equal(applicationLogKey);

            done();
        },
        operationTimeOut
    );

    test(
        'Should update name for created log container',
        async (done: $TSFixMe) => {
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );

            await init.pageWaitForSelector(page, `#edit_${applicationLogName}`);

            await init.pageClick(page, `#edit_${applicationLogName}`);
            // Fill and submit edit Application  log form

            await init.pageWaitForSelector(page, '#form-new-application-log');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', 'New');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#addApplicationLogButton', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClickNavigate(page, '#logs');

            let spanElement = await init.pageWaitForSelector(
                page,
                `#application-log-title-${applicationLogName}New`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(`${applicationLogName}New`);

            done();
        },
        operationTimeOut
    );

    test.skip(
        'Should update category for created log container',
        async (done: $TSFixMe) => {
            const categoryName: string = 'Another-Category';
            // create a new resource category
            await init.addResourceCategory(categoryName, page);

            await init.navigateToApplicationLogDetails(
                componentName,
                `${applicationLogName}New`,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#edit_${applicationLogName}New`
            );

            await init.pageClick(page, `#edit_${applicationLogName}New`);
            // Fill and submit edit Application  log form

            await init.pageWaitForSelector(page, '#form-new-application-log');
            // change category here
            await init.selectDropdownValue(
                '#resourceCategory',
                categoryName,
                page
            );

            await init.pageClickNavigate(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#addApplicationLogButton', {
                hidden: true,
            });
            await init.pageWaitForSelector(
                page,
                `#${applicationLogName}NewBadge`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // confirm the new category shows in the details page.
            let spanElement = await page.$(`#${applicationLogName}NewBadge`);
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
            const categoryName: string = 'Another-Category';

            // confirm the application log has a category
            await init.navigateToApplicationLogDetails(
                componentName,
                `${applicationLogName}New`,
                page
            );

            let spanElement = await page.$(`#${applicationLogName}NewBadge`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());

            // delete the category
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClickNavigate(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, 'li#resources a');

            await init.pageClickNavigate(page, 'li#resources a');

            await init.pageWaitForSelector(page, `#delete_${categoryName}`);

            await init.pageClick(page, `#delete_${categoryName}`);

            await init.pageWaitForSelector(page, '#deleteResourceCategory');

            await init.pageClick(page, '#deleteResourceCategory');

            // go back to log details and confirm it is not there anymore
            const spanElementBadge = await page.$(
                `#${applicationLogName}NewBadge`,
                { hidden: true }
            );
            expect(spanElementBadge).toBeNull();

            done();
        },
        operationTimeOut
    );
});
