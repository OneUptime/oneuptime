import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
// user credentials
const userEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
let browser, page;
const masterAdmin = {
    email: 'masteradmin@hackerbay.io',
    password: '1234567890',
};
describe('Enterprise User API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: userEmail,
            password: password,
        };
        // user
        await init.registerEnterpriseUser(user, page, false);
        await browser.close();
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should create a new user with correct details',
        async done => {
            browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
            page = await browser.newPage();
            await page.setUserAgent(utils.agent);

            const newEmail = utils.generateRandomBusinessEmail();

            await init.loginAdminUser(masterAdmin, page);

            await init.pageWaitForSelector(page, '#add_user');
            await init.pageClick(page, '#add_user');

            await init.pageWaitForSelector(page, '#email');
            await init.pageClick(page, 'input[name=email]');
            await init.pageType(page, 'input[name=email]', newEmail);
            await init.pageClick(page, 'input[name=name]');
            await init.pageType(page, 'input[name=name]', 'Test Name');
            await init.pageClick(page, 'input[name=companyName]');
            await init.pageType(page, 'input[name=companyName]', 'Test Name');
            await init.pageClick(page, 'input[name=companyPhoneNumber]');
            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            await init.pageClick(page, 'input[name=password]');
            await init.pageType(page, 'input[name=password]', '1234567890');
            await init.pageClick(page, 'input[name=confirmPassword]');
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, 'a.db-UserListRow');

            const userRows = await init.page$$(page, 'a.db-UserListRow');
            const countUsers = userRows.length;

            expect(countUsers).toBeGreaterThanOrEqual(2);

            await browser.close();
            done();
        },
        operationTimeOut
    );

    test(
        'Should get list of users and paginate for users',
        async done => {
            browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
            page = await browser.newPage();
            await page.setUserAgent(utils.agent);

            await init.loginAdminUser(masterAdmin, page);

            for (let i = 0; i < 10; i++) {
                // add new user
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await init.pageWaitForSelector(page, '#add_user');
                await init.pageClick(page, '#add_user');

                await init.pageWaitForSelector(page, '#email');
                await init.pageClick(page, 'input[name=email]');
                await init.pageType(
                    page,
                    'input[name=email]',
                    utils.generateRandomBusinessEmail()
                );
                await init.pageClick(page, 'input[name=name]');
                await init.pageType(page, 'input[name=name]', 'Test Name');
                await init.pageClick(page, 'input[name=companyName]');
                await init.pageType(
                    page,
                    'input[name=companyName]',
                    'Test Name'
                );
                await init.pageClick(page, 'input[name=companyPhoneNumber]');
                await init.pageType(
                    page,
                    'input[name=companyPhoneNumber]',
                    '99105688'
                );
                await init.pageClick(page, 'input[name=password]');
                await init.pageType(page, 'input[name=password]', '1234567890');
                await init.pageClick(page, 'input[name=confirmPassword]');
                await init.pageType(
                    page,
                    'input[name=confirmPassword]',
                    '1234567890'
                );
                await init.pageClick(page, 'button[type=submit]');
            }

            let userRows = await init.page$$(page, 'a.db-UserListRow');
            let countUsers = userRows.length;

            expect(countUsers).toEqual(10);

            const nextSelector = await init.page$(page, '#btnNext');

            await nextSelector.click();

            userRows = await init.page$$(page, 'a.db-UserListRow');
            countUsers = userRows.length;
            expect(countUsers).toBeGreaterThanOrEqual(2);

            const prevSelector = await init.page$(page, '#btnPrev');

            await prevSelector.click();

            userRows = await init.page$$(page, 'a.db-UserListRow');
            countUsers = userRows.length;
            expect(countUsers).toEqual(10);

            await browser.close();
            done();
        },
        init.timeout
    );

    test(
        'Should not create a user with incorrect details',
        async done => {
            browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
            page = await browser.newPage();
            await page.setUserAgent(utils.agent);

            await init.loginAdminUser(masterAdmin, page);

            await init.pageWaitForSelector(page, '#add_user');
            await init.pageClick(page, '#add_user');

            // user with non-business email
            await init.pageWaitForSelector(page, '#email');
            await init.pageClick(page, 'input[name=email]');
            await init.pageType(
                page,
                'input[name=email]',
                'oneuptime@gmail.com'
            );
            await init.pageClick(page, 'input[name=name]');
            await init.pageType(page, 'input[name=name]', 'Test Name');
            await init.pageClick(page, 'input[name=companyName]');
            await init.pageType(page, 'input[name=companyName]', 'Test Name');
            await init.pageClick(page, 'input[name=companyPhoneNumber]');
            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            await init.pageClick(page, 'input[name=password]');
            await init.pageType(page, 'input[name=password]', '1234567890');
            await init.pageClick(page, 'input[name=confirmPassword]');
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            await init.pageClick(page, 'button[type=submit]');

            const html = await init.page$Eval(page, '#frmUser', e => {
                return e.innerHTML;
            });
            html.should.containEql('Please enter a business email address.');

            await browser.close();
            done();
        },
        operationTimeOut
    );
});
