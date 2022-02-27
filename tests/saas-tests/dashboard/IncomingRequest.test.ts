// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};
const incidentRequest = {
    name: 'pyInt',
    incidentTitle: 'Test Incident',
    incidentType: 'offline',
    incidentDescription:
        'This is a sample incident to test incoming http request',
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incoming HTTP Request', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should configure incoming http request to create incident in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#integrations', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#integrations');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.http-request-tab');

            await init.pageWaitForSelector(page, '#addIncomingRequestBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addIncomingRequestBtn');
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', incidentRequest.name);
            await init.page$Eval(page, '#createIncident', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '#selectAllMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#selectAllMonitors', (elem: $TSFixMe) =>
                elem.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#advancedOptionsBtn');
            await init.pageWaitForSelector(page, '#incidentTitle', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentTitle');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#incidentTitle',
                incidentRequest.incidentTitle
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentDescription');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#incidentDescription',
                incidentRequest.incidentDescription
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createIncomingRequest');
            await init.pageWaitForSelector(page, '#createIncomingRequest', {
                hidden: true,
            });
            await init.pageWaitForSelector(page, '#requestOkBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#requestOkBtn');
            await init.pageWaitForSelector(page, '#requestOkBtn', {
                hidden: true,
            });

            const firstIncomingHttpRequest = await init.pageWaitForSelector(
                page,
                '#copyIncomingRequestBtn_0',
                { visible: true, timeout: init.timeout }
            );
            expect(firstIncomingHttpRequest).toBeDefined();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should update an incoming http request in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#integrations', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#integrations');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.http-request-tab');

            await init.pageWaitForSelector(page, '#editIncomingRequestBtn_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#editIncomingRequestBtn_0');
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name', { clickCount: 3 });
            // change the name of the incoming http request
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', 'newName');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#editIncomingRequest');
            await init.pageWaitForSelector(page, '#editIncomingRequest', {
                hidden: true,
            });

            const updatedRequest = await init.pageWaitForSelector(
                page,
                '#incomingRequest_newName',
                { visible: true, timeout: init.timeout }
            );
            expect(updatedRequest).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete an incoming http request in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#integrations', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#integrations');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.http-request-tab');

            await init.pageWaitForSelector(
                page,
                '#deleteIncomingRequestBtn_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteIncomingRequestBtn_0');
            await init.pageWaitForSelector(page, '#deleteIncomingRequestBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteIncomingRequestBtn');
            await init.pageWaitForSelector(page, '#deleteIncomingRequestBtn', {
                hidden: true,
            });

            const noIncomingRequest = await init.pageWaitForSelector(
                page,
                '#noIncomingRequest',
                { visible: true, timeout: init.timeout }
            );
            expect(noIncomingRequest).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
