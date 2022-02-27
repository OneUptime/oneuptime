// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const password = '1234567890';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('API Monitor API', () => {
    const operationTimeOut = init.timeout;

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

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
            () => (document.getElementById('header').value = '')
        );
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        await page.evaluate(() => (document.getElementById('body').value = ''));
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#responseTime');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=responseTime]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=responseTime]', '0');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#statusCode');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=statusCode]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=statusCode]', '200');
        await page.select('#responseType', 'json');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#header');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'textarea[name=header]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(
            page,
            'textarea[name=header]',
            '{"Content-Type":"application/json"}'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#body');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'textarea[name=body]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'textarea[name=body]', '{"status":"ok"}');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'button[type=submit]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#save-btn');
        await init.pageWaitForSelector(page, '#save-btn', {
            visible: true,
            timeout: init.timeout,
        });

        const user = {
            email: utils.generateRandomBusinessEmail(),
            password,
        };
        await init.registerUser(user, page);

        await init.addComponent(componentName, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add API monitor with invalid url',
        async (done: $TSFixMe) => {
            // Create Component first
            // Redirects automatically component to details page
            await init.navigateToComponentDetails(componentName, page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#url', 'https://google.com');
            await init.selectDropdownValue('#method', 'get', page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                '#formNewMonitorError'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(
                'API Monitor URL should not be a HTML page.'
            );
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add API monitor with invalid payload',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#url',
                'https://oneuptime.com/api/monitor/valid-project-id'
            );
            await init.selectDropdownValue('#method', 'post', page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const spanElement = await init.pageWaitForSelector(
                page,
                '#formNewMonitorError'
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add API monitor with invalid payload in advance options',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.selectDropdownValue('#method', 'post', page);
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#url',
                'https://oneuptime.com/api/monitor/valid-project-id'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#advanceOptions');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#advanceOptions');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addApiHeaders');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addApiHeaders');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                'input[id=headers_1000_0_key]'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=headers_1000_0_key]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[id=headers_1000_0_key]',
                'Authorization'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=headers_1000_0_value]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[id=headers_1000_0_value]',
                'Basic valid-token'
            );
            await init.selectDropdownValue('#bodyType', 'text/plain', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#feedback-textarea');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#feedback-textarea', 'BAD');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const spanElement = await init.pageWaitForSelector(
                page,
                '#formNewMonitorError'
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should add API monitor with valid url and payload',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.selectDropdownValue('#method', 'get', page);
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#url', 'http://localhost:3002/api');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);
            done();
        },
        operationTimeOut
    );
    // Tests Split
});
