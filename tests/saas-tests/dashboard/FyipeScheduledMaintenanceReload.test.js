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
const scheduleMaintenanceName = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Page Reload', () => {
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
        'Should reload the scheduled maintenance page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageClick(page, '#scheduledMaintenance');
            await init.pageClick(page, '#addScheduledEventButton');
            await page.waitForSelector('#scheduledEventForm', {
                visible: true,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', scheduleMaintenanceName);
            await init.pageClick(page, '#createScheduledEventButton');
            await page.waitForSelector('#scheduledEventForm', {
                hidden: true,
            });
            await init.pageClick(page, '#viewScheduledEvent_0');
            await page.waitForSelector(
                `#editScheduledEvent-${scheduleMaintenanceName}`,
                { visible: true, timeout: init.timeout }
            );

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbScheduledMaintenanceEvent', {
                visible: true,
            });
            await page.waitForSelector(`#cb${scheduleMaintenanceName}`, {
                visible: true,
            });
            const spanElement = await page.waitForSelector(
                `#editScheduledEvent-${scheduleMaintenanceName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
