import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Enterprise Disabled Billing API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await init.registerEnterpriseUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should not display project billing page after login',
        async done => {
            await init.adminLogout(page);
            await init.loginUser(user, page);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');

            const projectBilling = await page.$('#billingSetting');
            expect(projectBilling).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not display profile billing on profile menu',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#profile-menu');

            const profileBilling = await page.$('#cbBilling');
            expect(profileBilling).toBeNull();
            done();
        },
        operationTimeOut
    );
});
