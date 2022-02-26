// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Status Page -> Pricing Plan Component', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show upgrade modal if project is not available in a particular plan',
        async (done: $TSFixMe) => {
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"test"' is not assignable to par... Remove this comment to see the full error message
            await init.addProject(page, 'test');
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) => elem.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnCreateStatusPage_test');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnCreateStatusPage_test');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', 'test');
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
            await init.page$$Eval(page, '.advanced-options-tab', (elems: $TSFixMe) => elems[0].click()
            );
            await init.page$Eval(page, 'input[name="isPrivate"]', (elem: $TSFixMe) => elem.click()
            );
            const modal = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(modal).toBeDefined();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not show upgrade modal if project is subscribed to a particular plan',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#billing');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#billing a');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#alertEnable');

            const rowLength = await init.page$$Eval(
                page,
                '#alertOptionRow > div.bs-Fieldset-row',
                (rows: $TSFixMe) => rows.length
            );

            if (rowLength === 1) {
                // check the box
                await page.evaluate(() => {
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    document.querySelector('#alertEnable').click();
                });
            }

            await page.evaluate(() => {
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                document.querySelector('#billingRiskCountries').click();
            });
            const elem = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                {
                    hidden: true,
                }
            );
            expect(elem).toBeNull();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not upgrade a project when cancel button is clicked',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) => elem.click());
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
            await init.page$$Eval(page, '.advanced-options-tab', (elems: $TSFixMe) => elems[0].click()
            );
            await init.page$Eval(page, 'input[name="isPrivate"]', (elem: $TSFixMe) => elem.click()
            );

            await init.pageWaitForSelector(page, '#pricingPlanModal', {
                visible: true,
                timeout: init.timeout,
            });
            const growthOption = await init.pageWaitForSelector(
                page,
                'label[for=Growth_month]',
                { visible: true, timeout: init.timeout }
            );
            growthOption.click();
            await init.pageWaitForSelector(page, '#cancelPlanUpgrade', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#cancelPlanUpgrade');
            const elem = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                {
                    hidden: true,
                }
            );
            expect(elem).toBeNull();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should upgrade a plan when upgrade is triggered from pricing plan component',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) => elem.click());
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
            await init.page$$Eval(page, '.advanced-options-tab', (elems: $TSFixMe) => elems[0].click()
            );
            await init.page$Eval(page, 'input[name="isPrivate"]', (elem: $TSFixMe) => elem.click()
            );

            await init.pageWaitForSelector(page, '#pricingPlanModal', {
                visible: true,
                timeout: init.timeout,
            });
            const growthOption = await init.pageWaitForSelector(
                page,
                'label[for=Growth_month]',
                { visible: true, timeout: init.timeout }
            );
            growthOption.click();
            await init.pageWaitForSelector(page, '#confirmPlanUpgrade', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#confirmPlanUpgrade');

            await init.pageWaitForSelector(page, '#pricingPlanModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.advanced-options-tab', (elems: $TSFixMe) => elems[0].click()
            );

            await init.page$Eval(page, 'input[name="isPrivate"]', (elem: $TSFixMe) => elem.click()
            );
            const value = await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => elem.value
            );
            expect(utils.parseBoolean(value)).toBe(true);
            done();
        },
        operationTimeOut
    );
});
