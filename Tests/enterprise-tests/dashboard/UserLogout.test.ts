import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('User logout', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // Register user
        await init.registerEnterpriseUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Admin should be able to logout from dashboard (not AdminDashboard)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#logout-button');

            await init.pageClick(page, '#logout-button');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            expect(page.url()).toEqual(`${utils.ACCOUNTS_URL}/accounts/login`);
            done();
        },
        operationTimeOut
    );
});
