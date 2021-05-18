const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('SMTP Settings API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user

        const user = {
            email: email,
            password: password,
        };

        // user
        await init.loginAdminUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Admin should not turn on 2FA for a user',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '.bs-ObjectList-rows > a');
            const users = await page.$$('.bs-ObjectList-rows > a');
            await users[1].click();

            await init.pageWaitForSelector(page, '#disableUser2fa');
            await init.pageClick(page, '#disableUser2fa');

            await init.pageWaitForSelector(page, '.bs-Modal-content > span');
            let info = await page.$('.bs-Modal-content > span');
            expect(info).toBeDefined();
            info = await info.getProperty('innerText');
            info = await info.jsonValue();
            expect(info).toEqual('Only the user can turn on 2FA not the admin');
            done();
        },
        operationTimeOut
    );

    test(
        'Admin should not turn on or off his 2fa',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '.bs-ObjectList-rows > a');
            const users = await page.$$('.bs-ObjectList-rows > a');
            await users[0].click();

            const elem = await page.$('#disableUser2fa');
            expect(elem).toEqual(null);
            done();
        },
        operationTimeOut
    );
});
