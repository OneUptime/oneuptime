import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

describe('Status Page -> Pricing Plan Component', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show upgrade modal if project is not available in a particular plan',
        async (done: $TSFixMe) => {
            await init.addProject(page, 'test');
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) => {
                return elem.click();
            });

            await init.pageWaitForSelector(page, '#btnCreateStatusPage_test');

            await init.pageClick(page, '#btnCreateStatusPage_test');

            await init.pageWaitForSelector(page, '#name');

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', 'test');

            await init.pageClick(page, '#btnCreateStatusPage');
            // select the first item from the table row
            const rowItem: $TSFixMe = await init.pageWaitForSelector(
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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => {
                    return elem.click();
                }
            );
            const modal: $TSFixMe = await init.pageWaitForSelector(
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

    test(
        'should not show upgrade modal if project is subscribed to a particular plan',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#billing');

            await init.pageClick(page, '#billing a');

            await init.pageWaitForSelector(page, '#alertEnable');

            const rowLength: $TSFixMe = await init.page$$Eval(
                page,
                '#alertOptionRow > div.bs-Fieldset-row',
                (rows: $TSFixMe) => {
                    return rows.length;
                }
            );

            if (rowLength === 1) {
                // check the box
                await page.evaluate(() => {
                    document.querySelector('#alertEnable').click();
                });
            }

            await page.evaluate(() => {
                document.querySelector('#billingRiskCountries').click();
            });
            const elem: $TSFixMe = await init.pageWaitForSelector(
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

    test(
        'should not upgrade a project when cancel button is clicked',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) => {
                return elem.click();
            });
            // select the first item from the table row
            const rowItem: $TSFixMe = await init.pageWaitForSelector(
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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => {
                    return elem.click();
                }
            );

            await init.pageWaitForSelector(page, '#pricingPlanModal', {
                visible: true,
                timeout: init.timeout,
            });
            const growthOption: $TSFixMe = await init.pageWaitForSelector(
                page,
                'label[for=Growth_month]',
                { visible: true, timeout: init.timeout }
            );
            growthOption.click();
            await init.pageWaitForSelector(page, '#cancelPlanUpgrade', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#cancelPlanUpgrade');
            const elem: $TSFixMe = await init.pageWaitForSelector(
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

    test(
        'should upgrade a plan when upgrade is triggered from pricing plan component',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.page$Eval(page, '#statusPages', (elem: $TSFixMe) => {
                return elem.click();
            });
            // select the first item from the table row
            const rowItem: $TSFixMe = await init.pageWaitForSelector(
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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => {
                    return elem.click();
                }
            );

            await init.pageWaitForSelector(page, '#pricingPlanModal', {
                visible: true,
                timeout: init.timeout,
            });
            const growthOption: $TSFixMe = await init.pageWaitForSelector(
                page,
                'label[for=Growth_month]',
                { visible: true, timeout: init.timeout }
            );
            growthOption.click();
            await init.pageWaitForSelector(page, '#confirmPlanUpgrade', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#confirmPlanUpgrade');

            await init.pageWaitForSelector(page, '#pricingPlanModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );

            await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => {
                    return elem.click();
                }
            );
            const value: $TSFixMe = await init.page$Eval(
                page,
                'input[name="isPrivate"]',
                (elem: $TSFixMe) => {
                    return elem.value;
                }
            );
            expect(utils.parseBoolean(value)).toBe(true);
            done();
        },
        operationTimeOut
    );
});
