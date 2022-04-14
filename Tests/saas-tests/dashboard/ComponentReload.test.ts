import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName: string = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Component Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should create a component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.addComponent(componentName, page);
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#incidentLog', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentLog');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Log page inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#logs', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#logs');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbLogs', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Error tracking page inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#errorTracking', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#errorTracking');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbErrorTracking', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Performance tracker page inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#performanceTracker', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#performanceTracker');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbPerformanceTracker', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Container security page inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbContainerSecurity', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Application security inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbApplicationSecurity', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Component-Settings(Basic) inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#componentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#componentSettings');
            await init.pageWaitForSelector(page, '#basic', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#basic');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbComponentSettings', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to Component-Settings(Advanced) inside component and confirm there are no errors',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#componentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#componentSettings');
            await init.pageWaitForSelector(page, '#advanced', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#advanced');
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbAdvanced', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );
});
