import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Monitor Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the monitor in component-details page and confirm no error',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            // To confirm no error on page reload
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await page.reload({ waitUntil: 'networkidle2' });
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        operationTimeOut
    );

    test(
        'Should add a new monitor, reload and confirm no error',
        async done => {
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // To confirm no error on page reload
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, `#cb${monitorName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await page.reload({ waitUntil: 'networkidle2' });
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        operationTimeOut
    );
});
