// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const pageName = utils.generateRandomString();
const user = {
    email,
    password,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Status Page', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerEnterpriseUser(user, page);
        await init.adminLogout(page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not show upgrade modal if IS_SAAS_SERVICE is false',
        async (done: $TSFixMe) => {
            await init.loginUser(user, page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(
                page,
                'button[type="button"] .bs-FileUploadButton',
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                'button[type="button"] .bs-FileUploadButton'
            );
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', pageName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnCreateStatusPage');
            // select the first item from the table row
            const rowItem = await init.pageWaitForSelector(
                page,
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => elem.click()
            );

            const modal = await page.$('#pricingPlanModal');

            expect(modal).toBeNull();
            done();
        },
        operationTimeOut
    );
});
