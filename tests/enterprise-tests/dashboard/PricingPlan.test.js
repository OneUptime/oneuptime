const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const pageName = utils.generateRandomString();
const user = {
    email,
    password,
};

describe('Status Page', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerEnterpriseUser(user, page);
        await init.adminLogout(page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not show upgrade modal if IS_SAAS_SERVICE is false',
        async done => {
            await init.loginUser(user, page);
            //Pricing Plan is selectable for a user under growth plane.
            await init.growthPlanUpgrade(page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.$eval('#statusPages', elem => elem.click());
            await page.waitForSelector(
                'button[type="button"] .bs-FileUploadButton',
                { visible: true, timeout: init.timeout }
            );
            await init.pageClick(
                page,
                'button[type="button"] .bs-FileUploadButton'
            );
            await page.waitForSelector('#name', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', pageName);
            await init.pageClick(page, '#btnCreateStatusPage');
            // select the first item from the table row
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();
            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );
            await page.$eval('input[name="isPrivate"]', elem => elem.click());

            const modal = await page.$('#pricingPlanModal');

            expect(modal).toBeNull();
            done();
        },
        operationTimeOut
    );
});
