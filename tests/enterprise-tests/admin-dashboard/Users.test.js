const puppeteer = require('puppeteer');

const utils = require('../../test-utils');
const init = require('../../test-init');
let browser, page;
require('should');

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Users Component (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        await init.registerEnterpriseUser(user, page, false);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should show a button to add more users to fyipe from admin dashboard',
        async done => {
            // navigating to dashboard url
            // automatically redirects to users route
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // if element does not exist it will timeout and throw
            const elem = await page.waitForSelector('#add_user', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeTruthy();

            done();
        },
        operationTimeOut
    );

    test(
        'should logout and get redirected to the login page if the user deletes his account',
        async done => {
            // navigating to dashboard url
            // automatically redirects to users route
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const userSelector = '#masteradmin';
            await page.waitForSelector(userSelector);
            await init.pageClick(page, userSelector);

            await page.waitForSelector('#delete');
            await init.pageClick(page, '#delete');
            await page.waitForSelector('#confirmDelete');
            await init.pageClick(page, '#confirmDelete');
            await page.waitForSelector('#confirmDelete', { hidden: true });
            await page.waitForSelector('#users');
            await init.pageClick(page, '#users');
            const loginBtn = await page.waitForSelector('#login-button', {
                visible: true,
                timeout: init.timeout,
            });
            expect(loginBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
