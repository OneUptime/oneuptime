// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
// user credentials
const userEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
let browser: $TSFixMe, page;
const masterAdmin = {
    email: 'masteradmin@hackerbay.io',
    password: '1234567890',
};
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Enterprise User API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: userEmail,
            password: password,
        };
        // user
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 3.
        await init.registerEnterpriseUser(user, page, false);
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create a new user with correct details',
        async (done: $TSFixMe) => {
            browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
            page = await browser.newPage();
            await page.setUserAgent(utils.agent);

            const newEmail = utils.generateRandomBusinessEmail();

            await init.loginAdminUser(masterAdmin, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#add_user');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#add_user');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#email');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=email]', newEmail);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=name]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=companyName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=companyName]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=companyPhoneNumber]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=password]', '1234567890');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=confirmPassword]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'a.db-UserListRow');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const userRows = await init.page$$(page, 'a.db-UserListRow');
            const countUsers = userRows.length;

            expect(countUsers).toBeGreaterThanOrEqual(2);

            await browser.close();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should get list of users and paginate for users',
        async (done: $TSFixMe) => {
            browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
            page = await browser.newPage();
            await page.setUserAgent(utils.agent);

            await init.loginAdminUser(masterAdmin, page);

            for (let i = 0; i < 10; i++) {
                // add new user
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#add_user');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#add_user');

                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#email');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'input[name=email]');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    'input[name=email]',
                    utils.generateRandomBusinessEmail()
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'input[name=name]');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(page, 'input[name=name]', 'Test Name');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'input[name=companyName]');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    'input[name=companyName]',
                    'Test Name'
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'input[name=companyPhoneNumber]');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    'input[name=companyPhoneNumber]',
                    '99105688'
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'input[name=password]');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(page, 'input[name=password]', '1234567890');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'input[name=confirmPassword]');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    'input[name=confirmPassword]',
                    '1234567890'
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, 'button[type=submit]');
            }

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let userRows = await init.page$$(page, 'a.db-UserListRow');
            let countUsers = userRows.length;

            expect(countUsers).toEqual(10);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const nextSelector = await init.page$(page, '#btnNext');

            await nextSelector.click();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            userRows = await init.page$$(page, 'a.db-UserListRow');
            countUsers = userRows.length;
            expect(countUsers).toBeGreaterThanOrEqual(2);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const prevSelector = await init.page$(page, '#btnPrev');

            await prevSelector.click();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            userRows = await init.page$$(page, 'a.db-UserListRow');
            countUsers = userRows.length;
            expect(countUsers).toEqual(10);

            await browser.close();
            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not create a user with incorrect details',
        async (done: $TSFixMe) => {
            browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
            page = await browser.newPage();
            await page.setUserAgent(utils.agent);

            await init.loginAdminUser(masterAdmin, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#add_user');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#add_user');

            // user with non-business email
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#email');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=email]',
                'oneuptime@gmail.com'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=name]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=companyName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=companyName]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=companyPhoneNumber]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=password]', '1234567890');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=confirmPassword]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            const html = await init.page$Eval(page, '#frmUser', (e: $TSFixMe) => {
                return e.innerHTML;
            });
            html.should.containEql('Please enter a business email address.');

            await browser.close();
            done();
        },
        operationTimeOut
    );
});
