// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';
const user = {
    email: utils.generateRandomBusinessEmail(),
    password,
};

let projectId: $TSFixMe = null;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Project', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig, {
            waitUntil: 'networkidle2',
        });
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const adminUser = {
            email: email,
            password: password,
        };

        // login admin user
        await init.loginAdminUser(adminUser, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should upgrade a project to enterprise plan',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.createUserFromAdminDashboard(user, page);
            await page.reload({ waitUntil: 'networkidle2' });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projects');
            await init.page$Eval(page, '#projects > a', (elem: $TSFixMe) => elem.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '.Table > tbody tr');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const project = await init.pageWaitForSelector(page, '.projectId');
            projectId = await (
                await project.getProperty('innerText')
            ).jsonValue();

            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');
                // @ts-expect-error ts-migrate(2741) FIXME: Property 'item' is missing in type 'Element[]' but... Remove this comment to see the full error message
                elem = Array.from(elem);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
                elem[0].click();
            });

            await init.pageWaitForSelector(page, '#Enterprise', {
                visible: true,
                timeout: init.timeout,
            });

            await init.page$Eval(page, '#Enterprise', (elem: $TSFixMe) => elem.click());
            await init.page$Eval(page, '#submitChangePlan', (elem: $TSFixMe) => elem.click()
            );

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });

            const checked = await init.page$Eval(
                page,
                '#Enterprise',
                (elem: $TSFixMe) => elem.checked
            );

            expect(checked).toEqual(true);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should change to any other plan',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projects');
            await init.page$Eval(page, '#projects > a', (elem: $TSFixMe) => elem.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '.Table > tbody tr');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#project-' + projectId);

            await init.pageWaitForSelector(page, '#Growth_annual', {
                visible: true,
                timeout: init.timeout,
            });

            await init.page$Eval(page, '#Growth_annual', (elem: $TSFixMe) => elem.click());
            await init.page$Eval(page, '#submitChangePlan', (elem: $TSFixMe) => elem.click()
            );

            const loader = await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });

            const checked = await init.page$Eval(
                page,
                '#Growth_annual',
                (elem: $TSFixMe) => elem.checked
            );

            expect(loader).toBeNull();
            expect(checked).toEqual(true);
            done();
        },
        operationTimeOut
    );
});
