// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const anotherEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const scheduledEventName = utils.generateRandomString();

const user = {
    email,
    password,
};
require('should');

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Scheduled Event Note', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 4.
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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.timeline-tab');
            await init.pageWaitForSelector(page, '#add-internal-message', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#new-internal');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#new-internal',
                'Some random description'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#internal-addButton');
            await init.pageWaitForSelector(
                page,
                '#form-new-schedule-investigation-message',
                { hidden: true }
            );
            const note = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_0',
                { visible: true, timeout: init.timeout }
            );
            expect(note).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.timeline-tab');

            await init.pageWaitForSelector(
                page,
                '#edit_Internal_incident_message_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#edit_Internal_incident_message_0');
            await init.pageWaitForSelector(page, '#update-internal', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#update-internal');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#update-internal',
                'An updated description'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#internal-updateButton');
            await init.pageWaitForSelector(
                page,
                '#form-update-schedule-internal-message',
                { hidden: true }
            );
            const edited = await init.pageWaitForSelector(
                page,
                '#edited_Internal_incident_message_0',
                { visible: true, timeout: init.timeout }
            );
            expect(edited).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.timeline-tab');
            await init.pageWaitForSelector(
                page,
                '#delete_Internal_incident_message_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#delete_Internal_incident_message_0');
            await init.pageWaitForSelector(page, '#deleteNote', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteNote');
            await init.pageWaitForSelector(page, '#deleteNote', {
                hidden: true,
            });

            const note = await init.pageWaitForSelector(
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

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Scheduled Maintenance Note ==> Pagination and Deletion', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(1000000); // This requires custom timeout

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
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
        for (let i = 0; i < 15; i++) {
            const noteDescription = utils.generateRandomString();
            await init.addScheduledMaintenanceNote(
                page,
                'internal',
                'viewScheduledEvent_0',
                noteDescription
            );
        }

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.timeline-tab');
            const tenthItem = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_9',
                { visible: true, timeout: init.timeout }
            );
            expect(tenthItem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the note tab section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.timeline-tab');
            await init.pageWaitForSelector(page, '#nextBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#nextBtn');

            const fifthItem = await init.pageWaitForSelector(
                page,
                '#Internal_incident_message_4',
                { visible: true, timeout: init.timeout }
            );
            const sixthItem = await init.pageWaitForSelector(
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');

            await init.pageWaitForSelector(page, '#viewScheduledEvent_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewScheduledEvent_0');
            // navigate to the advance tab section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.advanced-options-tab');

            // look for the delete button and click on it
            await init.pageWaitForSelector(page, '#deleteScheduleEvent', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteScheduleEvent');

            // find the confirm delete button in the pop up and click on it
            await init.pageWaitForSelector(page, '#deleteScheduleModalBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteScheduleModalBtn');
            // confirm that the element is deleted and redirected to the list of all schedule event page
            await init.pageWaitForSelector(page, '#deleteScheduleModalBtn', {
                hidden: true,
            });
            const scheduledEventList = await init.pageWaitForSelector(
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
