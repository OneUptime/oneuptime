const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const anotherEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const scheduledEventName = utils.generateRandomString();

require('should');

describe('Scheduled Event Note', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };

            // user
            await init.registerUser(user, page);
            //await init.loginUser(user, page);
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
            await init.addScheduledMaintenance(monitorName, scheduledEventName,componentName, page);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should create an internal note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('#viewScheduledEvent_0', {
                    visible: true,
                });
                await page.click('#viewScheduledEvent_0');
                // navigate to the note tab section
                await init.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
                await page.waitForSelector('#add-internal-message', {
                    visible: true,
                });
                await page.click('#add-internal-message');
                await page.waitForSelector('#event_state', {
                    visible: true,
                });
                await init.selectByText('#event_state', 'investigating', page);
                await page.click('#new-internal');
                await page.type(
                    '#new-internal',
                    'Some random description'
                );
                await page.click('#internal-addButton');
                await page.waitForSelector(
                    '#form-new-schedule-investigation-message',
                    { hidden: true }
                );
                const note = await page.waitForSelector(
                    '#Internal_incident_message_0',
                    { visible: true }
                );
                expect(note).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should edit an internal note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('#viewScheduledEvent_0', {
                    visible: true,
                });
                await page.click('#viewScheduledEvent_0');
                // navigate to the note tab section
                await init.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);

                await page.waitForSelector(
                    '#edit_Internal_incident_message_0',
                    { visible: true }
                );
                await page.click('#edit_Internal_incident_message_0');
                await page.waitForSelector('#update-internal', {
                    visible: true,
                });
                await page.click('#update-internal', { clickCount: 3 });
                await page.type(
                    '#update-internal',
                    'An updated description'
                );
                await page.click('#internal-updateButton');
                await page.waitForSelector(
                    '#form-update-schedule-internal-message',
                    { hidden: true }
                );
                const edited = await page.waitForSelector(
                    '#edited_Internal_incident_message_0',
                    { visible: true }
                );
                expect(edited).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete an internal note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('#viewScheduledEvent_0', {
                    visible: true,
                });
                await page.click('#viewScheduledEvent_0');
                // navigate to the note tab section
                await init.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
                await page.waitForSelector(
                    '#delete_Internal_incident_message_0',
                    { visible: true }
                );
                await page.click('#delete_Internal_incident_message_0');
                await page.waitForSelector('#deleteNote', { visible: true });
                await page.click('#deleteNote');
                await page.waitForSelector('#deleteNote', { hidden: true });

                const note = await page.waitForSelector(
                    '#delete_Internal_incident_message_0',
                    { hidden: true }
                );
                expect(note).toBeNull();
            });
            done();
        },
        operationTimeOut
    );
    // Deleted three tests that repeated
    
 });

describe('Scheduled Maintenance Note ==> Pagination and Deletion', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.execute(null, async ({ page }) => {
            const user = {
                email: anotherEmail,
                password,
            };

            // user
            await init.registerUser(user, page);
            //await init.loginUser(user, page);
            // Create component and monitor
            await init.addMonitorToComponent(componentName, monitorName, page);
            // Create a scheduled event
            await init.addScheduledMaintenance(monitorName, scheduledEventName, componentName,page);
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
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should load first 10 scheduled maintenance note => internal note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('#viewScheduledEvent_0', {
                    visible: true,
                });
                await page.click('#viewScheduledEvent_0');
                // navigate to the note tab section
                await init.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
                const tenthItem = await page.waitForSelector(
                    '#Internal_incident_message_9',
                    { visible: true }
                );
                expect(tenthItem).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should load the remaining 5 scheduled maintenance note => internal note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('#viewScheduledEvent_0', {
                    visible: true,
                });
                await page.click('#viewScheduledEvent_0');
                // navigate to the note tab section
                await init.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
                await page.waitForSelector('#nextBtn', { visible: true });
                await page.click('#nextBtn');

                const fifthItem = await page.waitForSelector(
                    '#Internal_incident_message_4',
                    { visible: true }
                );
                const sixthItem = await page.waitForSelector(
                    '#Internal_incident_message_5',
                    { hidden: true }
                );

                expect(fifthItem).toBeDefined();
                expect(sixthItem).toBeNull();
            });
            done();
        },
        operationTimeOut
    );
    test(
        'should visit the advance section and delete the schedule maintenance',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#scheduledMaintenance', {
                    visible: true,
                });
                await page.click('#scheduledMaintenance');

                await page.waitForSelector('#viewScheduledEvent_0', {
                    visible: true,
                });
                await page.click('#viewScheduledEvent_0');
                // navigate to the advance tab section
                await init.gotoTab(utils.scheduleEventTabIndexes.ADVANCE, page);

                // look for the delete button and click on it
                await page.waitForSelector('#deleteScheduleEvent', {
                    visible: true,
                });
                await page.click('#deleteScheduleEvent');

                // find the confirm delete button in the pop up and click on it
                await page.waitForSelector('#deleteScheduleModalBtn', {
                    visible: true,
                });
                await page.click('#deleteScheduleModalBtn');
                // confirm that the element is deleted and redirected to the list of all schedule event page
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
            });
            done();
        },
        operationTimeOut
    );
});
