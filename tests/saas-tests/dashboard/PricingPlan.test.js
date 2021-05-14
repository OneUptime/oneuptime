const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Status Page -> Pricing Plan Component', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should show upgrade modal if project is not available in a particular plan',
        async done => {
            await init.addProject(page, 'test');
            await page.$eval('#statusPages', elem => elem.click());
            await page.waitForSelector('#btnCreateStatusPage_test');
            await init.pageClick(page, '#btnCreateStatusPage_test');
            await page.waitForSelector('#name');
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', 'test');
            await init.pageClick(page, '#btnCreateStatusPage');
            // select the first item from the table row
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();
            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );
            await page.$eval('input[name="isPrivate"]', elem => elem.click());
            const modal = await page.waitForSelector('#pricingPlanModal', {
                visible: true,
            });
            expect(modal).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should show upgrade modal if plan is Enterprise and Project is not on Enterprise plan',
        async () => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.$eval('#statusPages', elem => elem.click());
            // select the first item from the table row
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();

            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });

            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );

            await page.$eval('input[name="isSubscriberEnabled"]', elem =>
                elem.click()
            );

            const modal = await page.waitForSelector('#pricingPlanModal', {
                visible: true,
            });
            const emailBtn = await page.waitForSelector('#enterpriseMail');

            expect(modal).toBeDefined();
            expect(emailBtn).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'should not show upgrade modal if project is subscribed to a particular plan',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#billing');
            await init.pageClick(page, '#billing a');
            await page.waitForSelector('#alertEnable');

            const rowLength = await page.$$eval(
                '#alertOptionRow > div.bs-Fieldset-row',
                rows => rows.length
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
            const elem = await page.waitForSelector('#pricingPlanModal', {
                hidden: true,
            });
            expect(elem).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should not upgrade a project when cancel button is clicked',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.$eval('#statusPages', elem => elem.click());
            // select the first item from the table row
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();
            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );
            await page.$eval('input[name="isPrivate"]', elem => elem.click());

            await page.waitForSelector('#pricingPlanModal', {
                visible: true,
            });
            const growthOption = await page.waitForSelector(
                'label[for=Growth_month]',
                { visible: true, timeout: init.timeout }
            );
            growthOption.click();
            await page.waitForSelector('#cancelPlanUpgrade', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#cancelPlanUpgrade');
            const elem = await page.waitForSelector('#pricingPlanModal', {
                hidden: true,
            });
            expect(elem).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'should upgrade a plan when upgrade is triggered from pricing plan component',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.$eval('#statusPages', elem => elem.click());
            // select the first item from the table row
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();
            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );
            await page.$eval('input[name="isPrivate"]', elem => elem.click());

            await page.waitForSelector('#pricingPlanModal', {
                visible: true,
            });
            const growthOption = await page.waitForSelector(
                'label[for=Growth_month]',
                { visible: true, timeout: init.timeout }
            );
            growthOption.click();
            await page.waitForSelector('#confirmPlanUpgrade', {
                visible: true,
            });
            await init.pageClick(page, '#confirmPlanUpgrade');

            await page.waitForSelector('#pricingPlanModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );

            await page.$eval('input[name="isPrivate"]', elem => elem.click());
            const value = await page.$eval(
                'input[name="isPrivate"]',
                elem => elem.value
            );
            expect(utils.parseBoolean(value)).toBe(true);
            done();
        },
        operationTimeOut
    );
});
