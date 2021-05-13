const puppeteer = require('puppeteer');

const utils = require('../../test-utils');
const init = require('../../test-init');
let browser, page;
require('should');

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Settings Component (IS_SAAS_SERVICE=false)', () => {
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
        'should show settings option in the admin dashboard',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // if element does not exist it will timeout and throw
            const elem = await page.waitForSelector('#settings', {
                visible: true,
            });
            expect(elem).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'should show license option in the admin dashboard',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await page.waitForSelector('#settings', { visible: true });
            await page.$eval('#settings a', elem => elem.click());

            // if element does not exist it will timeout and throw
            const licenseOption = await page.waitForSelector('#license', {
                visible: true,
            });
            expect(licenseOption).toBeDefined();
        },
        operationTimeOut
    );
});
