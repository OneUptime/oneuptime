const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Component Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should create a component and confirm there are no errors',
        async done => {
            await init.addComponent(componentName, page);
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#incidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#incidentLog');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Log page inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#logs', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#logs');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbLogs', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Error tracking page inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#errorTracking', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#errorTracking');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbErrorTracking', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Performance tracker page inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#performanceTracker', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#performanceTracker');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbPerformanceTracker', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Container security page inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#security', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#security');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbContainerSecurity', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Application security inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#security', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#application', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#application');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbApplicationSecurity', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Component-Settings(Basic) inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#componentSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#componentSettings');
            await page.waitForSelector('#basic', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#basic');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('#cbComponentSettings', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Component-Settings(Advanced) inside component and confirm there are no errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await page.waitForSelector('#componentSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#componentSettings');
            await page.waitForSelector('#advanced', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#advanced');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbAdvanced', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );
});
