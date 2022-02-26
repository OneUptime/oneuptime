// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const testServerMonitorName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Monitor API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(600000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);
        await init.addHttpTestServerMonitorToComponent(
            componentName,
            testServerMonitorName,
            page
        );
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should degrade (not timeout and return status code 408) monitor with response time longer than init.timeoutms and status code 200', async (done: $TSFixMe) => {
        const bodyText = utils.generateRandomString();
        // This navigates to hhtp-test server and create the settings for the test suite
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('statusCode').value = '')
        );
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('header').value = '{}')
        );
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        await page.evaluate(() => (document.getElementById('body').value = ''));
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#responseTime');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=responseTime]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=responseTime]', '6000'); //Any response time greater than 5000ms and status code 200 will return degraded.
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#statusCode');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=statusCode]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=statusCode]', '200');
        await page.select('#responseType', 'html');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#body');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'textarea[name=body]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(
            page,
            'textarea[name=body]',
            `<h1 id="html"><span>${bodyText}</span></h1>`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'button[type=submit]');
        await init.pageWaitForSelector(page, '#save-btn', {
            visible: true,
            timeout: init.timeout,
        });

        // Component and Monitor are already created. This is code refactoring
        await init.navigateToMonitorDetails(
            componentName,
            testServerMonitorName,
            page
        );

        await init.pageWaitForSelector(page, '#notificationscroll', {
            visbile: true,
            timeout: 600000,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(
            page,
            `#${testServerMonitorName}-degraded`
        );
        let monitorStatusElement = await init.pageWaitForSelector(
            page,
            `#monitor-status-${testServerMonitorName}`,
            { visible: true, timeout: operationTimeOut }
        );
        monitorStatusElement = await monitorStatusElement.getProperty(
            'innerText'
        );
        monitorStatusElement = await monitorStatusElement.jsonValue();
        monitorStatusElement.should.be.exactly('Degraded');

        done();
    }, 600000);
});
