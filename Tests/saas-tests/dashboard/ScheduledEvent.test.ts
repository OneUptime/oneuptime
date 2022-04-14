import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: $TSFixMe = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const componentName: $TSFixMe = utils.generateRandomString();
const monitorName: $TSFixMe = utils.generateRandomString();
const scheduleMaintenanceName: $TSFixMe = utils.generateRandomString();
const newScheduledMaintenanceName: $TSFixMe = utils.generateRandomString();

const user: $TSFixMe = {
    email,
    password,
};

describe('Scheduled event', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

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

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test.skip(
        // It is no longer possible to duplicate a monitor with the new interface.
        'should not create a new scheduled event for duplicate monitor selection',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');
            await init.pageWaitForSelector(page, '#addScheduledEventButton', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addScheduledEventButton');

            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#name');

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', scheduleMaintenanceName);

            await init.pageClick(page, 'label[for=selectAllMonitorsBox]');

            await init.pageClick(page, '#addMoreMonitor');

            await init.pageWaitForSelector(page, '#monitorfield_0');
            await init.selectDropdownValue(
                '#monitorfield_0',
                componentName,
                page
            ); // "ComponentName / MonitorName" is in the dropdown. Using only ComponentName selects both

            await init.pageClick(page, '#addMoreMonitor');

            await init.pageWaitForSelector(page, '#monitorfield_1');
            await init.selectDropdownValue(
                '#monitorfield_1',
                componentName,
                page
            );

            await init.pageClick(page, '#description');

            await init.pageType(
                page,
                '#description',
                'This is an example description for a test'
            );

            await init.pageWaitForSelector(page, 'input[name=startDate]');

            await init.pageClick(page, 'input[name=startDate]');

            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );

            await init.pageClick(page, 'input[name=endDate]');

            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );

            await init.pageClick(page, '#createScheduledEventButton');
            const monitorError: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#monitorError',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(monitorError).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should create a new scheduled event for a monitor',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');
            await init.pageWaitForSelector(page, '#addScheduledEventButton', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addScheduledEventButton');

            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#name');

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', scheduleMaintenanceName);

            await init.pageWaitForSelector(
                page,
                'label[for=selectAllMonitors]'
            );

            await init.pageClick(page, '#selectSpecificMonitors');

            await init.pageClick(page, '#monitorDropdown');

            await init.pageClick(page, `#${monitorName}`);

            await init.pageClick(page, 'label[for=monitorIds]');

            await init.pageClick(page, '#description');

            await init.pageType(
                page,
                '#description',
                'This is an example description for a test'
            );

            await init.pageWaitForSelector(page, 'input[name=startDate]');

            await init.pageClick(page, 'input[name=startDate]');

            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );

            await init.pageClick(page, 'input[name=endDate]');

            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );

            await init.pageClick(page, '#createScheduledEventButton');
            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                hidden: true,
            });
            await init.pageWaitForSelector(page, '.scheduled-event-list-item', {
                visible: true,
                timeout: init.timeout,
            });

            const scheduledMaintenanceList: $TSFixMe = await init.page$$(
                page,
                '.scheduled-event-list-item'
            );

            expect(scheduledMaintenanceList.length).toBeGreaterThanOrEqual(1);
            done();
        },
        operationTimeOut
    );

    test(
        'should update the created scheduled event for a monitor',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');
            //Refactored UI
            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            await init.pageWaitForSelector(
                page,
                `#editScheduledEvent-${scheduleMaintenanceName}`,
                {
                    visible: true,
                }
            );

            await init.pageClick(
                page,
                `#editScheduledEvent-${scheduleMaintenanceName}`
            );

            await init.pageWaitForSelector(page, '#editScheduledEventForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#name');
            await init.pageClick(page, '#name', { clickCount: 3 });

            await init.pageType(page, '#name', newScheduledMaintenanceName);

            await init.pageClick(page, '#updateScheduledEventButton');
            await init.pageWaitForSelector(page, '#editScheduledEventForm', {
                hidden: true,
            });

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '.scheduled-event-name', {
                visible: true,
                timeout: init.timeout,
            });
            const eventName: $TSFixMe = await page.evaluate(
                () =>
                    document.querySelector('.scheduled-event-name').textContent
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');
            //Refactored UI
            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(page, '#deleteScheduleEvent', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteScheduleEvent');
            await init.pageWaitForSelector(page, '#deleteScheduleModalBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteScheduleModalBtn');
            await init.pageWaitForSelector(page, '#deleteScheduleModalBtn', {
                hidden: true,
            });
            const scheduledEventList: $TSFixMe = await init.pageWaitForSelector(
                page,
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
