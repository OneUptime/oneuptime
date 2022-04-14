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
const componentName: string = utils.generateRandomString();
const applicationLogName: string = 'AppLogName';

describe('Log Containers', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

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

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
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
        'Should create new log container and confirm that it redirects to the details page',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            // Fill and submit New Application  log form

            await init.pageWaitForSelector(page, '#form-new-application-log');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', applicationLogName);

            await init.pageClick(page, 'button[type=submit]');

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `span#application-log-title-${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(applicationLogName);

            // find the log api key button which appears only on the details page

            const logKeyElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#key_${applicationLogName}`
            );
            expect(logKeyElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test.skip(
        'Should create new resource category then redirect to application log page to create a container under that',
        async (done: $TSFixMe) => {
            const categoryName: string = 'Random-Category';
            const appLogName: string = 'NewAppLog';
            // create a new resource category
            await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(componentName, page);
            // go to logs

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');
            // create a new log and select the category
            // Fill and submit New Application  log form

            await init.pageWaitForSelector(page, '#cbLogs');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-application-log');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', appLogName);
            await init.selectDropdownValue(
                '#resourceCategory',
                categoryName,
                page
            );

            await init.pageClick(page, 'button[type=submit]');
            // confirm the category shows in the details page.
            await init.pageWaitForSelector(page, `#${appLogName}Badge`, {
                visible: true,
                timeout: init.timeout,
            });

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#${appLogName}Badge`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());

            done();
        },
        operationTimeOut
    );

    test(
        'Should not create new log container',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            // Fill and submit New Application  log form

            await init.pageWaitForSelector(page, '#cbLogs');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-application-log');
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
                '#form-new-application-log span#field-error',
                { visible: true, timeout: init.timeout }
            );

            let spanElement: $TSFixMe = await init.page$(
                page,
                '#form-new-application-log span#field-error'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('This field cannot be left blank');

            done();
        },
        operationTimeOut
    );

    test(
        'Should open details page of created log container',
        async (done: $TSFixMe) => {
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#application-log-title-${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(applicationLogName);

            done();
        },
        operationTimeOut
    );

    test(
        'Should display warning for empty log container',
        async (done: $TSFixMe) => {
            // goto thee details page
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );

            // get the error element, Expect it to be defined

            const errorElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#${applicationLogName}-no-log-warning`
            );
            expect(errorElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should filter log container by selected log type',
        async (done: $TSFixMe) => {
            // goto thee details page
            await init.navigateToApplicationLogDetails(
                componentName,
                applicationLogName,
                page
            );

            // toggle the filter section

            await init.pageWaitForSelector(
                page,
                `#filter_${applicationLogName}`
            );

            await init.pageClick(page, `#filter_${applicationLogName}`);

            // select the drop down and confirm the current value as all
            let logTypeElement: $TSFixMe = await init.pageWaitForSelector(
                /** React-Select Library is used in the dashboard
                 * This reminds puppeteer that the <input /> is hidden
                 * as init.pageWaitForSelector is 'visible : true' by default  */

                page,
                'input[name=log_type_selector]',
                { hidden: true }
            );
            logTypeElement = await logTypeElement.getProperty('value');

            logTypeElement = await logTypeElement.jsonValue();
            logTypeElement.should.be.exactly('');

            // click on the warning tab
            await init.pageClick(page, '#log_type_selector', { hidden: true });
            await init.pageType(page, '#log_type_selector', 'Warning', {
                hidden: true,
            });
            await page.keyboard.press('Tab');
            logTypeElement = await init.pageWaitForSelector(
                page,
                'input[name=log_type_selector]',
                { hidden: true }
            );
            logTypeElement = await logTypeElement.getProperty('value');

            logTypeElement = await logTypeElement.jsonValue();
            logTypeElement.should.be.exactly('warning');

            // click on the info tab
            await init.pageClick(page, '#log_type_selector', { hidden: true });
            await init.pageType(page, '#log_type_selector', 'Info', {
                hidden: true,
            });
            await page.keyboard.press('Tab');

            // confim that thee drop down current value is info
            logTypeElement = await init.pageWaitForSelector(
                page,
                'input[name=log_type_selector]',
                { hidden: true }
            );
            logTypeElement = await logTypeElement.getProperty('value');

            logTypeElement = await logTypeElement.jsonValue();
            logTypeElement.should.be.exactly('info');

            // click on the error tab
            await init.pageClick(page, '#log_type_selector', { hidden: true });
            await init.pageType(page, '#log_type_selector', 'Error', {
                hidden: true,
            });
            await page.keyboard.press('Tab');

            // confim that thee drop down current value is error
            logTypeElement = await init.pageWaitForSelector(
                page,
                'input[name=log_type_selector]',
                { hidden: true }
            );
            logTypeElement = await logTypeElement.getProperty('value');

            logTypeElement = await logTypeElement.jsonValue();
            logTypeElement.should.be.exactly('error');

            // click on the all tab
            await init.pageClick(page, '#log_type_selector', { hidden: true });
            await init.pageType(page, '#log_type_selector', 'All Logs', {
                hidden: true,
            });
            await page.keyboard.press('Tab');

            // confim that thee drop down current value is all
            logTypeElement = await init.pageWaitForSelector(
                page,
                'input[name=log_type_selector]',
                { hidden: true }
            );
            logTypeElement = await logTypeElement.getProperty('value');

            logTypeElement = await logTypeElement.jsonValue();
            logTypeElement.should.be.exactly('');

            done();
        },
        operationTimeOut
    );

    /**Test Split */
});
