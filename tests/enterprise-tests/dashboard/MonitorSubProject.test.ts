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
describe('Enterprise Monitor SubProject API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerEnterpriseUser(user, page);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create a monitor in sub-project for valid `admin`',
        async (done: $TSFixMe) => {
            const subProjectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            const subProjectMonitorName = utils.generateRandomString();

            await init.adminLogout(page);
            await init.loginUser(user, page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // add sub-project
            await init.addSubProject(subProjectName, page);

            // Create Component first
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            // switch to invited project for new user
            await init.pageWaitForSelector(page, '#monitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#form-new-monitor', {
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
            await init.pageType(page, 'input[id=name]', subProjectMonitorName);
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

            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${subProjectMonitorName}`,
                { visible: true, timeout: init.timeout }
            );

            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toBe(subProjectMonitorName);

            done();
        },
        operationTimeOut
    );
});
