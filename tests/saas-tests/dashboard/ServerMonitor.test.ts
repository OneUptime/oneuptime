// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'axios' or its corresponding ty... Remove this comment to see the full error message
import axios from 'axios';
axios.defaults.adapter = require('axios/lib/adapters/http');
let serverMonitor: $TSFixMe;
try {
    // try to use local package (with recent changes)
    serverMonitor = require('../../../../js-sdk/src/cli/server-monitor/lib/api');
} catch (error) {
    // @ts-expect-error ts-migrate(1232) FIXME: An import declaration can only be used in a namesp... Remove this comment to see the full error message
    import oneuptime from 'oneuptime';
    serverMonitor = oneuptime.ServerMonitor;
}

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Server Monitor API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);
        await init.loginUser(user, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create offline incident if no data is uploaded in 3 minutes after creating server monitor',
        async () => {
            // Create Component first
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.selectDropdownValue('#type', 'server-monitor', page);
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

            await init.pageWaitForSelector(page, 'span#activeIncidentsText', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let activeIncidents = await init.page$(
                page,
                'span#activeIncidentsText'
            );
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('1 Incident Currently Active');
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should auto acknowledge and resolve offline incident',
        async () => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#api');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#api a');

            let projectId = await init.page$(page, '#projectId', {
                visible: true,
                timeout: init.timeout,
            });
            projectId = await projectId.getProperty('innerText');
            projectId = await projectId.jsonValue();

            let apiUrl = await init.page$(page, '#apiUrl', {
                visible: true,
                timeout: init.timeout,
            });
            apiUrl = await apiUrl.getProperty('innerText');
            apiUrl = await apiUrl.jsonValue();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#apiKey');
            let apiKey = await init.page$(page, '#apiKey', {
                visible: true,
                timeout: init.timeout,
            });
            apiKey = await apiKey.getProperty('innerText');
            apiKey = await apiKey.jsonValue();

            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            let monitorId = await init.pageWaitForSelector(page, '#monitorId', {
                visible: true,
                timeout: operationTimeOut,
            });
            monitorId = await monitorId.getProperty('innerText');
            monitorId = await monitorId.jsonValue();

            const monitor = serverMonitor({
                simulate: 'online',
                projectId,
                apiUrl,
                apiKey,
                monitorId,
            });

            monitor.start();

            await init.pageWaitForSelector(page, 'span#activeIncidentsText', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let activeIncidents = await init.page$(
                page,
                'span#activeIncidentsText'
            );
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('No incidents currently active.');

            monitor.stop();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create degraded incident',
        async () => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#api');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#api a');

            let projectId = await init.page$(page, '#projectId', {
                visible: true,
                timeout: init.timeout,
            });
            projectId = await projectId.getProperty('innerText');
            projectId = await projectId.jsonValue();

            let apiUrl = await init.page$(page, '#apiUrl', {
                visible: true,
                timeout: init.timeout,
            });
            apiUrl = await apiUrl.getProperty('innerText');
            apiUrl = await apiUrl.jsonValue();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#apiKey');
            let apiKey = await init.page$(page, '#apiKey', {
                visible: true,
                timeout: init.timeout,
            });
            apiKey = await apiKey.getProperty('innerText');
            apiKey = await apiKey.jsonValue();

            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            let monitorId = await init.pageWaitForSelector(page, '#monitorId', {
                visible: true,
                timeout: operationTimeOut,
            });
            monitorId = await monitorId.getProperty('innerText');
            monitorId = await monitorId.jsonValue();

            const monitor = serverMonitor({
                simulate: 'degraded',
                projectId,
                apiUrl,
                apiKey,
                monitorId,
            });

            monitor.start();

            // check status
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const element = await init.pageWaitForSelector(
                page,
                `#${monitorName}-degraded`
            );
            expect(element).toBeDefined();

            monitor.stop();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create offline incident',
        async () => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#api');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#api a');

            let projectId = await init.page$(page, '#projectId', {
                visible: true,
                timeout: init.timeout,
            });
            projectId = await projectId.getProperty('innerText');
            projectId = await projectId.jsonValue();

            let apiUrl = await init.page$(page, '#apiUrl', {
                visible: true,
                timeout: init.timeout,
            });
            apiUrl = await apiUrl.getProperty('innerText');
            apiUrl = await apiUrl.jsonValue();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#apiKey');
            let apiKey = await init.page$(page, '#apiKey', {
                visible: true,
                timeout: init.timeout,
            });
            apiKey = await apiKey.getProperty('innerText');
            apiKey = await apiKey.jsonValue();

            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            let monitorId = await init.pageWaitForSelector(page, '#monitorId', {
                visible: true,
                timeout: operationTimeOut,
            });
            monitorId = await monitorId.getProperty('innerText');
            monitorId = await monitorId.jsonValue();

            const monitor = serverMonitor({
                simulate: 'offline',
                projectId,
                apiUrl,
                apiKey,
                monitorId,
            });

            monitor.start();

            // check status
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const element = await init.pageWaitForSelector(
                page,
                `#${monitorName}-offline`
            );
            expect(element).toBeDefined();

            monitor.stop();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create offline incident 3 minutes after daemon is turned off',
        async () => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#api');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#api a');

            let projectId = await init.page$(page, '#projectId', {
                visible: true,
                timeout: init.timeout,
            });
            projectId = await projectId.getProperty('innerText');
            projectId = await projectId.jsonValue();

            let apiUrl = await init.page$(page, '#apiUrl', {
                visible: true,
                timeout: init.timeout,
            });
            apiUrl = await apiUrl.getProperty('innerText');
            apiUrl = await apiUrl.jsonValue();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#apiKey');
            let apiKey = await init.page$(page, '#apiKey', {
                visible: true,
                timeout: init.timeout,
            });
            apiKey = await apiKey.getProperty('innerText');
            apiKey = await apiKey.jsonValue();

            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            let monitorId = await init.pageWaitForSelector(page, '#monitorId', {
                visible: true,
                timeout: operationTimeOut,
            });
            monitorId = await monitorId.getProperty('innerText');
            monitorId = await monitorId.jsonValue();

            const monitor = serverMonitor({
                simulate: 'online',
                projectId,
                apiUrl,
                apiKey,
                monitorId,
            });

            monitor.start();

            monitor.stop();

            await init.pageWaitForSelector(page, 'span#activeIncidentsText', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let activeIncidents = await init.page$(
                page,
                'span#activeIncidentsText'
            );
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('1 Incident Currently Active');
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create offline incident 3 minutes after manually resolving incident and daemon is turned off',
        async () => {
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#${monitorName}_EditIncidentDetails_0`
            );
            await init.page$Eval(
                page,
                `#${monitorName}_EditIncidentDetails_0`,
                (e: $TSFixMe) => e.click()
            );

            await init.page$Eval(
                page,
                `#${monitorName}_EditIncidentDetails_0`,
                (e: $TSFixMe) => e.click()
            );

            await init.pageWaitForSelector(page, 'span#activeIncidentsText', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let activeIncidents = await init.page$(
                page,
                'span#activeIncidentsText'
            );
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('No incidents currently active.');

            await init.pageWaitForSelector(page, 'span#activeIncidentsText', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            activeIncidents = await init.page$(
                page,
                'span#activeIncidentsText'
            );
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('1 Incident Currently Active');
        },
        operationTimeOut
    );
});
