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

describe('Enterprise Dashboard API', () => {
    const operationTimeOut = init.timeout;
    const monitorName = utils.generateRandomString();
    const componentName = utils.generateRandomString();

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await init.registerEnterpriseUser(user, page);
        await init.logout(page);
        await init.loginUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        // delete monitor
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await init.pageWaitForSelector(page, '#components');

        await init.pageClick(page, '#components');

        await init.pageWaitForSelector(page, `#more-details-${componentName}`);

        await init.pageClick(page, `#more-details-${componentName}`);

        await init.pageWaitForSelector(page, `#more-details-${monitorName}`);

        await init.pageClick(page, `#more-details-${monitorName}`);

        await init.pageWaitForSelector(page, `#delete_${monitorName}`);

        await init.pageClick(page, `#delete_${monitorName}`);

        await init.pageWaitForSelector(page, '#deleteMonitor');

        await init.pageClick(page, '#deleteMonitor');
        await init.pageWaitForSelector(page, '#deleteMonitor', {
            hidden: true,
        });

        // delete component
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await init.pageWaitForSelector(page, '#components');

        await init.pageClick(page, '#components');

        await init.pageWaitForSelector(page, `#more-details-${componentName}`);

        await init.pageClick(page, `#more-details-${componentName}`);

        await init.pageWaitForSelector(page, `#componentSettings`);

        await init.pageClick(page, `#componentSettings`);

        await init.pageWaitForSelector(page, `#advanced`);

        await init.pageClick(page, `#advanced`);

        await init.pageWaitForSelector(
            page,
            `#delete-component-${componentName}`
        );

        await init.pageClick(page, `#delete-component-${componentName}`);

        await init.pageWaitForSelector(page, '#deleteComponent');

        await init.pageClick(page, '#deleteComponent');
        await init.pageWaitForSelector(page, '#deleteComponent', {
            hidden: true,
        });

        await browser.close();
        done();
    });

    it(
        'Should create new monitor with correct details',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.page$Eval(page, '#components', (el: $TSFixMe) =>
                el.click()
            );

            // Fill and submit New Component form

            await init.pageWaitForSelector(page, '#form-new-component');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', componentName);

            await init.pageClick(page, 'button[type=submit]');
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.page$Eval(page, '#components', (el: $TSFixMe) =>
                el.click()
            );

            // Navigate to details page of component created in previous test

            await init.pageWaitForSelector(
                page,
                `#more-details-${componentName}`
            );

            await init.pageClick(page, `#more-details-${componentName}`);
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });

            // Fill and submit New Monitor form
            await init.pageClick(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', monitorName);

            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#url');

            await init.pageType(page, '#url', 'https://google.com');

            await init.pageClick(page, 'button[type=submit]');

            let spanElement;

            spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            done();
        },
        operationTimeOut
    );

    it(
        'Should not create new monitor when details are incorrect',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.page$Eval(page, '#components', (el: $TSFixMe) =>
                el.click()
            );

            // Navigate to details page of component created in previous test

            await init.pageWaitForSelector(
                page,
                `#more-details-${componentName}`
            );

            await init.pageClick(page, `#more-details-${componentName}`);
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });

            // Submit New Monitor form with incorrect details

            await init.pageWaitForSelector(page, '#name');

            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#url', 'https://google.com');

            await init.pageClick(page, 'button[type=submit]');

            let spanElement;

            spanElement = await init.pageWaitForSelector(
                page,
                '#form-new-monitor span#field-error'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('This field cannot be left blank');

            done();
        },
        operationTimeOut
    );
});
