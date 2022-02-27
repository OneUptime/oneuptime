// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('OneUptime Monitor Reload', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.addIncident(monitorName, 'Offline', page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#closeIncident_0');
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should reload the monitor in component-details page and confirm no error',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#incidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbIncidents');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#incident_title_0`);
            //To confirm no error on page reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                `#incident_title_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to incident detail page and reload to check errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#incidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentLog');
            await init.pageWaitForSelector(page, `#incident_title_0`, {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClickNavigate(page, `#incident_title_0`);

            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });
            //To confirm no error on page reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#incident_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to incident page, click on the incident and reload to check errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#incidents', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidents');
            await init.pageWaitForSelector(page, `#incident_title_0`, {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClickNavigate(page, `#incident_title_0`);
            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });
            //To confirm no error on page reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncident', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#incident_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
