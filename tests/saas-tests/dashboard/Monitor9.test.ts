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
    const testMonitorName = utils.generateRandomString();

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
        'should add API monitor with valid url and evaluate response (online criteria) in advance options',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            //const newMonitorName = utils.generateRandomString();
            await init.addAPIMonitorWithJSExpression(page, testMonitorName);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${testMonitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(testMonitorName);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
            for (const probeTab of probeTabs) {
                await probeTab.click();

                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                let monitorStatusElement = await init.page$(
                    page,
                    `#monitor-status-${testMonitorName}`
                );
                if (monitorStatusElement) {
                    monitorStatusElement = await monitorStatusElement.getProperty(
                        'innerText'
                    );
                    monitorStatusElement = await monitorStatusElement.jsonValue();
                    monitorStatusElement.should.be.exactly('Online');
                }
            }
            done();
        },
        operationTimeOut
    );
    // Second Monitor has been created an will be used in most of the remaining tests.
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should strip trailing semicolons from evaluate response js expressions',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                testMonitorName,
                page
            );

            const editButtonSelector = `#edit_${testMonitorName}`;
            await init.pageWaitForSelector(page, editButtonSelector, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, editButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#advanceOptions');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#advanceOptions');

            // for online criteria
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const upFields = await init.page$$(
                page,
                `input[name*="up_"][name*=".field1"]`
            );
            const lastUpField = upFields[upFields.length - 1];
            const upExpression = await (
                await lastUpField.getProperty('value')
            ).jsonValue();

            expect(upExpression).toEqual("response.body.status === 'ok'");

            // for degraded criteria
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const degradedFields = await init.page$$(
                page,
                `input[name*="degraded_"][name*=".field1"]`
            );
            const lastDegradedField = degradedFields[degradedFields.length - 1];
            const degradedExpression = await (
                await lastDegradedField.getProperty('value')
            ).jsonValue();
            expect(degradedExpression).toEqual(
                "response.body.message === 'draining'"
            );
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should evaluate response (degraded criteria) in advance options',
        async (done: $TSFixMe) => {
            await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
            await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => (document.getElementById('responseTime').value = '')
            );
            await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => (document.getElementById('body').value = '')
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#responseTime');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=responseTime]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=responseTime]', '5000');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#body');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'textarea[name=body]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'textarea[name=body]',
                '{"message":"draining"}'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#save-btn');
            await init.pageWaitForSelector(page, '#save-btn', {
                visible: true,
                timeout: init.timeout,
            });

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#notificationscroll');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#closeIncident_0');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '.Text-color--yellow');
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                testMonitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
            for (const probeTab of probeTabs) {
                await probeTab.click();

                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#monitor-color-yellow');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                let monitorStatusElement = await init.page$(
                    page,
                    `#monitor-status-${testMonitorName}`
                );
                if (monitorStatusElement) {
                    monitorStatusElement = await monitorStatusElement.getProperty(
                        'innerText'
                    );
                    monitorStatusElement = await monitorStatusElement.jsonValue();
                    monitorStatusElement.should.be.exactly('Degraded');
                }
            }
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should evaluate response (offline criteria) in advance options',
        async (done: $TSFixMe) => {
            // This navigates to http-server and creates the appropriate settings before dashboard page.
            await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
            await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => (document.getElementById('statusCode').value = '')
            );
            await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => (document.getElementById('body').value = '')
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusCode');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=statusCode]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=statusCode]', '400');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#body');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'textarea[name=body]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'textarea[name=body]',
                '{"message":"offline"}'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#save-btn');
            await init.pageWaitForSelector(page, '#save-btn', {
                visible: true,
                timeout: init.timeout,
            });

            // Dashboard Page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#notificationscroll');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#closeIncident_0');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '.Text-color--red');
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                testMonitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
            for (const probeTab of probeTabs) {
                await probeTab.click();

                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#monitor-color-red');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                let monitorStatusElement = await init.page$(
                    page,
                    `#monitor-status-${testMonitorName}`
                );
                if (monitorStatusElement) {
                    monitorStatusElement = await monitorStatusElement.getProperty(
                        'innerText'
                    );
                    monitorStatusElement = await monitorStatusElement.jsonValue();
                    monitorStatusElement.should.be.exactly('Offline');
                }
            }
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should display offline status if evaluate response does not match in criteria', async (done: $TSFixMe) => {
        // This navigates to http-server and creates the appropriate settings before dashboard page.
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('statusCode').value = '')
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
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#body');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'textarea[name=body]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'textarea[name=body]', '{"status":"not ok"}');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'button[type=submit]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#save-btn');
        await init.pageWaitForSelector(page, '#save-btn', {
            visible: true,
            timeout: init.timeout,
        });

        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        // Navigate to Monitor details
        await init.navigateToMonitorDetails(
            componentName,
            testMonitorName,
            page
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
        for (const probeTab of probeTabs) {
            await probeTab.click();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#monitor-color-red');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let monitorStatusElement = await init.page$(
                page,
                `#monitor-status-${testMonitorName}`
            );
            if (monitorStatusElement) {
                monitorStatusElement = await monitorStatusElement.getProperty(
                    'innerText'
                );
                monitorStatusElement = await monitorStatusElement.jsonValue();
                monitorStatusElement.should.be.exactly('Offline');
            }
        }
        done();

        operationTimeOut;
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show specific property, button and modal for evaluate response',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            const newMonitorName = utils.generateRandomString();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#newFormId');
            await init.addAPIMonitorWithJSExpression(page, newMonitorName, {
                createAlertForOnline: true,
            });

            // wait for a new incident is created
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#notificationscroll');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewIncident-0');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let monitorIncidentReportElement = await init.pageWaitForSelector(
                page,
                `#${newMonitorName}_IncidentReport_0`
            );
            monitorIncidentReportElement = await monitorIncidentReportElement.getProperty(
                'innerText'
            );
            monitorIncidentReportElement = await monitorIncidentReportElement.jsonValue();
            expect(monitorIncidentReportElement).toContain(
                'Response {"status":"not ok"} Did evaluate response.body.status === \'ok\'.'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#${newMonitorName}_ShowResponse_0`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#${newMonitorName}_ShowResponse_0`);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let monitorIncidentModalElement = await init.pageWaitForSelector(
                page,
                '#API_Response'
            );
            monitorIncidentModalElement = await monitorIncidentModalElement.getProperty(
                'innerText'
            );
            monitorIncidentModalElement = await monitorIncidentModalElement.jsonValue();
            monitorIncidentModalElement.should.be.exactly('API Response');
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete API monitors',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                testMonitorName,
                page
            );
            const deleteButtonSelector = `#delete_${testMonitorName}`;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, deleteButtonSelector);
            await init.page$Eval(page, deleteButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            const confirmDeleteButtonSelector = '#deleteMonitor';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, confirmDeleteButtonSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, confirmDeleteButtonSelector);
            await init.pageWaitForSelector(page, confirmDeleteButtonSelector, {
                hidden: true,
            });

            const selector = `span#monitor-title-${testMonitorName}`;
            const spanElement = await init.page$(page, selector, {
                hidden: true,
            });
            expect(spanElement).toBeNull();
            done();
        },
        operationTimeOut
    );
});
