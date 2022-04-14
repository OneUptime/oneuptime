import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: string = 'masteradmin@hackerbay.io';
const password: string = '1234567890';
const createUserMail: Email = utils.generateRandomBusinessEmail();

describe('SMTP Settings API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user

        const user: $TSFixMe = {
            email: email,
            password: password,
        };

        // user
        await init.loginAdminUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Admin should not turn on 2FA for a user',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.createUserFromAdminDashboard(
                { email: createUserMail },
                page
            );
            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageWaitForSelector(page, '.bs-ObjectList-rows > a');

            const users = await init.page$$(page, '.bs-ObjectList-rows > a');
            await users[1].click();

            await init.pageWaitForSelector(page, '#disableUser2fa');

            await init.pageClick(page, '#disableUser2fa');

            await init.pageWaitForSelector(page, '.bs-Modal-content > span');

            let info: $TSFixMe = await init.page$(
                page,
                '.bs-Modal-content > span'
            );
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
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '.bs-ObjectList-rows > a');

            const users = await init.page$$(page, '.bs-ObjectList-rows > a');
            await users[0].click();

            const elem = await init.isElementOnPage(page, '#disableUser2fa');
            expect(elem).toEqual(false);
            done();
        },
        operationTimeOut
    );
});
