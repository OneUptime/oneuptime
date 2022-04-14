import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const anotherEmail: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const componentName: string = utils.generateRandomString();
const monitorName: string = utils.generateRandomString();
const scheduledEventName: string = utils.generateRandomString();

const user: $TSFixMe = {
    email,
    password,
};
import 'should';

describe('Scheduled Event Note', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // Register user

        // user
        await init.registerUser(user, page);
        // Create component
        await init.addComponent(componentName, page);
        // Create monitor
        await init.addMonitorToComponent(
            null,
            monitorName,
            page,

            componentName
        );
        // Create a scheduled maintenance
        await init.addScheduledMaintenance(
            monitorName,
            scheduledEventName,
            componentName,
            page
        );

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should create an internal note',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section

            await init.pageClick(page, '.timeline-tab');
            await init.pageWaitForSelector(page, '#add-internal-message', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#add-internal-message');
            await init.pageWaitForSelector(page, '#event_state', {
                visible: true,
                timeout: init.timeout,
            });
            await init.selectDropdownValue(
                '#event_state',
                'investigating',
                page
            );

            await init.pageClick(page, '#new-internal');

            await init.pageType(
                page,
                '#new-internal',
                'Some random description'
            );

            await init.pageClick(page, '#internal-addButton');
            await init.pageWaitForSelector(
                page,
                '#form-new-schedule-investigation-message',
                { hidden: true }
            );
            const note: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_0',
                { visible: true, timeout: init.timeout }
            );
            expect(note).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should edit an internal note',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section

            await init.pageClick(page, '.timeline-tab');

            await init.pageWaitForSelector(
                page,
                '#edit_Internal_incident_message_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, '#edit_Internal_incident_message_0');
            await init.pageWaitForSelector(page, '#update-internal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#update-internal');

            await init.pageType(
                page,
                '#update-internal',
                'An updated description'
            );

            await init.pageClick(page, '#internal-updateButton');
            await init.pageWaitForSelector(
                page,
                '#form-update-schedule-internal-message',
                { hidden: true }
            );
            const edited: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#edited_Internal_incident_message_0',
                { visible: true, timeout: init.timeout }
            );
            expect(edited).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete an internal note',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section

            await init.pageClick(page, '.timeline-tab');
            await init.pageWaitForSelector(
                page,
                '#delete_Internal_incident_message_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, '#delete_Internal_incident_message_0');
            await init.pageWaitForSelector(page, '#deleteNote', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteNote');
            await init.pageWaitForSelector(page, '#deleteNote', {
                hidden: true,
            });

            const note: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#delete_Internal_incident_message_0',
                { hidden: true }
            );
            expect(note).toBeNull();
            done();
        },
        operationTimeOut
    );
    // Deleted three tests that repeated
});

describe('Scheduled Maintenance Note ==> Pagination and Deletion', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(1000000); // This requires custom timeout

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user: $TSFixMe = {
            email: anotherEmail,
            password,
        };

        // user
        await init.registerUser(user, page);
        // Create component and monitor
        await init.addMonitorToComponent(componentName, monitorName, page);
        // Create a scheduled event
        await init.addScheduledMaintenance(
            monitorName,
            scheduledEventName,
            componentName,
            page
        );
        // create multiple notes
        for (let i: $TSFixMe = 0; i < 15; i++) {
            const noteDescription: string = utils.generateRandomString();
            await init.addScheduledMaintenanceNote(
                page,
                'internal',
                'viewScheduledEvent_0',
                noteDescription
            );
        }

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should load first 10 scheduled maintenance note => internal note',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section

            await init.pageClick(page, '.timeline-tab');
            const tenthItem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_9',
                { visible: true, timeout: init.timeout }
            );
            expect(tenthItem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should load the remaining 5 scheduled maintenance note => internal note',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section

            await init.pageClick(page, '.timeline-tab');
            await init.pageWaitForSelector(page, '#nextBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#nextBtn');

            const fifthItem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_4',
                { visible: true, timeout: init.timeout }
            );
            const sixthItem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_5',
                { hidden: true }
            );

            expect(fifthItem).toBeDefined();
            expect(sixthItem).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should visit the advance section and delete the schedule maintenance',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the advance tab section

            await init.pageClick(page, '.advanced-options-tab');

            // look for the delete button and click on it
            await init.pageWaitForSelector(page, '#deleteScheduleEvent', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteScheduleEvent');

            // find the confirm delete button in the pop up and click on it
            await init.pageWaitForSelector(page, '#deleteScheduleModalBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteScheduleModalBtn');
            // confirm that the element is deleted and redirected to the list of all schedule event page
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
