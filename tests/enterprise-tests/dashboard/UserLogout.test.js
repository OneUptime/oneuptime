const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('User logout', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // Register user
        await init.registerEnterpriseUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Admin should be able to logout from dashboard (not admin-dashboard)',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForTimeout('#profile-menu');
            await page.click('#profile-menu');
            await page.waitForTimeout('#logout-button');
            await Promise.all([
                page.click('#logout-button'),
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);

            await Promise.all([
                page.goto(utils.ADMIN_DASHBOARD_URL),
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);
            expect(page.url()).toEqual(`${utils.ACCOUNTS_URL}/accounts/login`);
            done();
        },
        operationTimeOut
    );
});
