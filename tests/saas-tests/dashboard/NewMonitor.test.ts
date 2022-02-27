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
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('New Monitor API', () => {
    const operationTimeOut = 1000000; // Custom Timeout is needed

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
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Startup plan => 5 Monitors/User)",
        async (done: $TSFixMe) => {
            const componentName = utils.generateRandomString();
            // create a component
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);
            // This the first monitor
            const firstMonitorName = utils.generateRandomString();
            await init.addNewMonitorToComponent(
                page,
                componentName,
                firstMonitorName
            );

            for (let i = 0; i < 4; i++) {
                // This adds 4 more monitors
                // The Interface for adding additional monitor has been updated
                const monitorName = utils.generateRandomString();

                await init.addAdditionalMonitorToComponent(
                    page,
                    componentName,
                    monitorName
                );
                await init.pageWaitForSelector(page, '.ball-beat', {
                    hidden: true,
                });
            }
            // try to add more monitor
            const monitorName = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');
            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#more-details-${componentName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#newFormId');
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
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
            // Added new URL-Montior
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#url', 'https://google.com');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            const pricingPlanModal = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                { visible: true, timeout: init.timeout }
            );
            expect(pricingPlanModal).toBeTruthy();
            done();
        },
        operationTimeOut
    );
    /** Test Split*/
});
