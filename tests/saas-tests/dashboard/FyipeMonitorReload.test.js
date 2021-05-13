const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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

describe('Fyipe Monitor Reload', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(100000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

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
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
            });
            await page.waitForSelector('#cbMonitors', { visible: true });

            let spanElement = await page.waitForSelector(
                `#monitor-title-${monitorName}`,
                { visible: true }
            );
            spanElement = spanElement.getProperty('innerText');
            spanElement = spanElement.jsonValue();
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
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
            });
            await page.waitForSelector('#cbMonitors', { visible: true });
            await page.waitForSelector(`#cb${monitorName}`, { visible: true });

            let spanElement = await page.waitForSelector(
                `#monitor-title-${monitorName}`,
                { visible: true }
            );
            spanElement = spanElement.getProperty('innerText');
            spanElement = spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        operationTimeOut
    );
});
