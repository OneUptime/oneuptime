// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'
let browser: $TSFixMe, page: $TSFixMe;

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Project', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        await init.registerEnterpriseUser(user, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not show upgrade/downgrade box if IS_SAAS_SERVICE is false',
        async () => {
            const email = utils.generateRandomBusinessEmail();
            const password = '1234567890';

            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.createUserFromAdminDashboard({ email, password }, page);

            await init.page$Eval(page, '#projects > a', (elem: $TSFixMe) => elem.click());
            await page.reload({ waitUntil: 'networkidle0' });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const elem = await init.page$$(page, 'table > tbody > tr');
            elem[0].click();

            await page.waitForNavigation({ waitUntil: 'networkidle0' });
            const planBox = await page.$('#planBox');
            expect(planBox).toBeNull();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projects', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projects');

            const firstProject = await init.pageWaitForSelector(
                page,
                '#project_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            firstProject.click();

            await init.pageWaitForSelector(page, '#delete', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#delete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            const restoreBtn = await init.pageWaitForSelector(
                page,
                '#restore',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(restoreBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should restore a deleted project',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projects', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projects');

            const firstProject = await init.pageWaitForSelector(
                page,
                '#project_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            firstProject.click();
            await init.pageWaitForSelector(page, '#restore', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#restore');

            const deleteBtn = await init.pageWaitForSelector(page, '#delete', {
                visible: true,
                timeout: init.timeout,
            });
            expect(deleteBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
