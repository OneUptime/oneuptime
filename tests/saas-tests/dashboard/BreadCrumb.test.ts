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
describe('BreadCrumb Component test', () => {
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
        'Should navigate between pages from the breadcrumbs',
        async (done: $TSFixMe) => {
            const componentName = utils.generateRandomString();
            const monitorName = utils.generateRandomString();

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.addMonitorToComponent(componentName, monitorName, page);

            const monitorBreadcrumb = await init.pageWaitForSelector(
                page,
                `#cb${monitorName}`,
                {
                    visible: true,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const componentBreadcrumb = await init.pageWaitForSelector(
                page,
                '#cbMonitors'
            );
            expect(monitorBreadcrumb).toBeDefined();
            expect(componentBreadcrumb).toBeDefined();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#cbMonitors');

            const monitorTitle = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(monitorTitle).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not go to the landing page when the project breadcrumb item is clicked',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#cbUnnamedProject', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#cbUnnamedProject');
            let currentPage = await init.pageWaitForSelector(
                page,
                '#cbUnnamedProject',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            currentPage = await currentPage.getProperty('innerText');
            currentPage = await currentPage.jsonValue();
            expect(currentPage).toBe('Unnamed Project');

            done();
        },
        operationTimeOut
    );
});
