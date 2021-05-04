const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

let browser,page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const scheduleMaintenanceName = utils.generateRandomString();
const newScheduledMaintenanceName = utils.generateRandomString();

const user = {
    email,
    password,
};
describe('Scheduled event', () => {
    const operationTimeOut = 50000;
    

    beforeAll(async () => {
        jest.setTimeout(200000);
        
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user
            await init.registerUser(user, page);
            // Create component
            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName,
                page,
                componentName
            );        
    });

    afterAll(async done => {        
        await browser.close();
        done();
    });

    test(
        'should not create a new scheduled event for duplicate monitor selection',
        async done => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');
                await page.waitForSelector('#addScheduledEventButton', {
                    visible: true,
                });
                await page.click('#addScheduledEventButton');

                await page.waitForSelector('#scheduledEventForm', {
                    visible: true,
                });
                await page.waitForSelector('#name');
                await page.click('#name');
                await page.type('#name', scheduleMaintenanceName);
                await page.click('label[for=selectAllMonitorsBox]');
                await page.click('#addMoreMonitor');
                await page.waitForSelector('#monitorfield_0');
                await init.selectByText('#monitorfield_0', componentName, page); // "ComponentName / MonitorName" is in the dropdown. Using only ComponentName selects both
                await page.click('#addMoreMonitor');
                await page.waitForSelector('#monitorfield_1');
                await init.selectByText('#monitorfield_1', componentName, page);
                await page.click('#description');
                await page.type(
                    '#description',
                    'This is an example description for a test'
                );

                /**
                 * commented the code below because the current date is the default selection
                 * and to reduce the amount of time for a test
                 */

                // await page.waitForSelector('input[name=startDate]');
                // await page.click('input[name=startDate]');
                // await page.click(
                //     'div.MuiDialogActions-root button:nth-child(2)'
                // );
                // await page.waitForTimeout(1000); // needed because of the date picker
                // await page.click('input[name=endDate]');
                // await page.click(
                //     'div.MuiDialogActions-root button:nth-child(2)'
                // );
                // await page.waitForTimeout(1000); // needed because of the date picker
                await page.click('#createScheduledEventButton');
                const monitorError = await page.waitForSelector(
                    '#monitorError',
                    { visible: true }
                );
                expect(monitorError).toBeDefined();            
            done();
        },
        operationTimeOut
    );

    test(
        'should create a new scheduled event for a monitor',
        async done => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');
                await page.waitForSelector('#addScheduledEventButton', {
                    visible: true,
                });
                await page.click('#addScheduledEventButton');

                await page.waitForSelector('#scheduledEventForm', {
                    visible: true,
                });
                await page.waitForSelector('#name');
                await page.click('#name');
                await page.type('#name', scheduleMaintenanceName);
                await page.click('label[for=selectAllMonitorsBox]');
                await page.click('#addMoreMonitor');
                await page.waitForSelector('#monitorfield_0');
                await init.selectByText('#monitorfield_0', componentName, page);
                await page.click('#description');
                await page.type(
                    '#description',
                    'This is an example description for a test'
                );

                /**
                 * commented the code below because the current date is the default selection
                 * and to reduce the amount of time for a test
                 */

                // await page.waitForSelector('input[name=startDate]');
                // await page.click('input[name=startDate]');
                // await page.click(
                //     'div.MuiDialogActions-root button:nth-child(2)'
                // );
                // await page.waitForTimeout(1000); // needed because of the date picker
                // await page.click('input[name=endDate]');
                // await page.click(
                //     'div.MuiDialogActions-root button:nth-child(2)'
                // );
                // await page.waitForTimeout(1000); // needed because of the date picker
                await page.click('#createScheduledEventButton');
                await page.waitForSelector('#scheduledEventForm', {
                    hidden: true,
                });
                await page.waitForSelector('.scheduled-event-list-item', {
                    visible: true,
                });
                const scheduledMaintenanceList = await page.$$(
                    '.scheduled-event-list-item'
                );

                expect(scheduledMaintenanceList.length).toBeGreaterThanOrEqual(
                    1
                );            
            done();
        },
        operationTimeOut
    );

    test(
        'should update the created scheduled event for a monitor',
        async done => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');
                //Refactored UI
                await page.waitForSelector('#viewScheduledEvent_0', {visible: true});
                await page.click('#viewScheduledEvent_0');
                await page.waitForSelector(`#editScheduledEvent-${scheduleMaintenanceName}`, {
                    visible: true,
                });
                await page.click(`#editScheduledEvent-${scheduleMaintenanceName}`);

                await page.waitForSelector('#editScheduledEventForm', {
                    visible: true,
                });
                await page.waitForSelector('#name');
                await page.click('#name', { clickCount: 3 });
                await page.type('#name', newScheduledMaintenanceName);
                await page.click('#updateScheduledEventButton');
                await page.waitForSelector('#editScheduledEventForm', {
                    hidden: true,
                });

                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('.scheduled-event-name', {
                    visible: true,
                });
                const eventName = await page.evaluate(
                    () =>
                        document.querySelector('.scheduled-event-name')
                            .textContent
                );
                expect(eventName).toMatch(
                    utils.capitalize(newScheduledMaintenanceName)
                );            
            done();
        },
        operationTimeOut
    );

    test(
        'should delete the created scheduled event for a monitor',
        async done => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');
                //Refactored UI
                await page.waitForSelector('#viewScheduledEvent_0', {visible: true});
                await page.click('#viewScheduledEvent_0');
                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[2].click() // To navigate to advanced section of the scheduled maintenance
                );

                await page.waitForSelector('#deleteScheduleEvent', {
                    visible: true,
                });
                await page.click('#deleteScheduleEvent');
                await page.waitForSelector('#deleteScheduleModalBtn', {
                    visible: true,
                });
                await page.click('#deleteScheduleModalBtn');
                await page.waitForSelector('#deleteScheduleModalBtn', {
                    hidden: true,
                });
                const scheduledEventList = await page.waitForSelector(
                    '.scheduled-event-list-item',
                    {
                        hidden: true,
                    }
                );
                expect(scheduledEventList).toBeNull();            
            done();
        },
        operationTimeOut
    );
});
