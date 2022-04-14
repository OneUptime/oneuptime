import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
let browser: $TSFixMe, page: $TSFixMe;
const projectName = utils.generateRandomString();
const projectMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

const message = utils.generateRandomString();

describe('Incident Timeline API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email,
            password,
        };
        // user
        await init.registerUser(user, page);

        // rename default project
        await init.renameProject(projectName, page);

        // Create component
        await init.addComponent(componentName, page);

        // add new monitor to project
        await init.pageWaitForSelector(page, '#form-new-monitor', {
            visible: true,
            timeout: init.timeout,
        });
        await init.page$Eval(page, 'input[id=name]', (e: $TSFixMe) =>
            e.click()
        );

        await init.pageType(page, 'input[id=name]', projectMonitorName);

        await init.pageClick(page, '[data-testId=type_url]');
        await init.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: init.timeout,
        });
        await init.page$Eval(page, '#url', (e: $TSFixMe) => e.click());

        await init.pageType(page, '#url', 'https://google.com'); //'HTTP_TEST_SERVER' auto generates incidents and this breaks the test. Also, the tests are not dependent on HTTP_TEST_SERVER
        await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
            e.click()
        );
        await init.pageWaitForSelector(
            page,
            `#monitor-title-${projectMonitorName}`,
            {
                visible: true,
            }
        );
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should create incident in project and add to message to the incident message thread',
        async (done: $TSFixMe) => {
            const type: string = 'internal';
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(
                page,
                `#create_incident_${projectMonitorName}`
            );

            await init.pageClick(
                page,
                `#create_incident_${projectMonitorName}`
            );

            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            await init.selectDropdownValue('#incidentPriority', 'High', page);

            await init.pageType(page, '#title', 'new incident');

            await init.pageWaitForSelector(page, '#createIncident');

            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            // navigate to monitor details

            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );
            //Incident Notes Tab has been refactored. It functionality is now in 'Incident Timeline' which is below the BASIC tab.

            // fill investigation message thread form
            await init.pageWaitForSelector(page, `#add-${type}-message`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#add-${type}-message`);

            await init.pageWaitForSelector(
                page,
                `#form-new-incident-${type}-message`
            );

            await init.pageClick(page, '#incident_description');

            await init.pageType(page, '#incident_description', `${message}`);
            await init.selectDropdownValue(
                '#incident_state',
                'investigating',
                page
            );

            await init.pageClick(page, `#${type}-addButton`);
            await init.pageWaitForSelector(page, `#${type}-addButton`, {
                hidden: true,
            });

            await init.pageWaitForSelector(
                page,
                `#content_${type}_incident_message_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const investigationMessage = await init.page$(
                page,
                `#content_${type}_incident_message_0`
            );
            let messageContent: $TSFixMe = await investigationMessage.getProperty(
                'innerText'
            );
            messageContent = await messageContent.jsonValue();
            expect(messageContent).toEqual(`${message}`);

            done();
        },
        operationTimeOut
    );

    test(
        'should edit message related to incident message thread',
        async (done: $TSFixMe) => {
            const type: string = 'internal';
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            // navigate to monitor details
            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );

            //Incident Notes Tab has been refactored. It functionality is now in 'Incident Timeline' which is below the BASIC tab.

            await init.pageWaitForSelector(
                page,
                `#edit_${type}_incident_message_0`
            );

            await init.pageClick(page, `#edit_${type}_incident_message_0`);

            // edit investigation message thread form

            await init.pageClick(page, '#incident_description');

            await init.pageType(page, '#incident_description', '-updated');
            await init.selectDropdownValue('#incident_state', 'update', page);

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, `#${type}-editButton`, {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });
            //Incident Notes Tab has been refactored. It functionality is now in 'Incident Timeline' which is below the BASIC tab.
            await init.pageWaitForSelector(
                page,
                `#content_${type}_incident_message_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const investigationMessage = await init.page$(
                page,
                `#content_${type}_incident_message_0`
            );
            let messageContent: $TSFixMe = await investigationMessage.getProperty(
                'innerText'
            );
            messageContent = await messageContent.jsonValue();
            expect(messageContent).toEqual(`${message}-updated`);

            done();
        },
        operationTimeOut
    );

    test(
        'should used existing incident and add to message to the internal incident message thread',
        async (done: $TSFixMe) => {
            const type: string = 'internal';
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details
            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );
            // fill internal message thread form

            await init.pageWaitForSelector(page, `#add-${type}-message`);
            await init.page$Eval(page, `#add-${type}-message`, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(
                page,
                `#form-new-incident-${type}-message`
            );

            await init.pageClick(page, '#incident_description');

            await init.pageType(page, '#incident_description', `${message}`);
            await init.selectDropdownValue('#incident_state', 'others', page);

            await init.pageClick(page, 'input[name=custom_incident_state]');

            await init.pageType(
                page,
                'input[name=custom_incident_state]',
                'automation'
            );

            await init.pageClick(page, `#${type}-addButton`);
            await init.pageWaitForSelector(page, `#${type}-addButton`, {
                hidden: true,
            });

            await init.pageWaitForSelector(
                page,
                `#content_${type}_incident_message_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const incidentMessage = await init.page$(
                page,
                `#content_${type}_incident_message_0`
            );
            let messageContent: $TSFixMe = await incidentMessage.getProperty('innerText');
            messageContent = await messageContent.jsonValue();

            expect(messageContent).toMatch(`${message}`);

            done();
        },
        operationTimeOut
    );

    test(
        'should edit message related to internal incident message thread',
        async (done: $TSFixMe) => {
            const type: string = 'internal';
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details
            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(
                page,
                `#edit_${type}_incident_message_0`
            );

            await init.pageClick(page, `#edit_${type}_incident_message_0`);

            // edit investigation message thread form

            await init.pageWaitForSelector(page, `#${type}-editButton`);

            await init.pageClick(page, '#incident_description');

            await init.pageType(page, '#incident_description', '-updated');
            await init.selectDropdownValue(
                '#incident_state',
                'investigating',
                page
            );

            await init.pageClick(page, `#${type}-editButton`);
            await init.pageWaitForSelector(page, `#${type}-editButton`, {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });

            await init.pageWaitForSelector(
                page,
                `#content_${type}_incident_message_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const incidentMessage = await init.page$(
                page,
                `#content_${type}_incident_message_0`
            );
            let messageContent: $TSFixMe = await incidentMessage.getProperty('innerText');
            messageContent = await messageContent.jsonValue();
            expect(messageContent).toEqual(`${message}-updated`);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete message related to internal incident message thread',
        async (done: $TSFixMe) => {
            const type: string = 'internal';
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details

            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(
                page,
                `#delete_${type}_incident_message_0`
            );

            await init.pageClick(page, `#delete_${type}_incident_message_0`);

            // click confirmation delete button

            await init.pageWaitForSelector(page, '#deleteIncidentMessage');

            await init.pageClick(page, '#deleteIncidentMessage');
            await init.pageWaitForSelector(page, '#deleteIncidentMessage', {
                hidden: true,
            });

            const incidentMessage = await init.pageWaitForSelector(
                page,
                `#content_${type}_incident_message_0`,
                { hidden: true }
            );
            expect(incidentMessage).toEqual(null);

            done();
        },
        operationTimeOut
    );

    test(
        'should get incident timeline and paginate for incident timeline in project',
        async () => {
            //
            const internalNote = utils.generateRandomString();
            const type: string = 'internal';
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details

            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );
            for (let i = 0; i < 10; i++) {
                // add internal note
                await init.pageWaitForSelector(page, `#add-${type}-message`, {
                    visible: true,
                });

                await init.pageClick(page, `#add-${type}-message`);

                await init.pageWaitForSelector(
                    page,
                    `#form-new-incident-${type}-message`
                );

                await init.pageClick(page, '#incident_description');

                await init.pageType(
                    page,
                    '#incident_description',
                    `${internalNote}`
                );
                await init.selectDropdownValue(
                    '#incident_state',
                    'update',
                    page
                );

                await init.pageClick(page, `#${type}-addButton`);
                await init.pageWaitForSelector(page, `#${type}-addButton`, {
                    hidden: true,
                });
            }
            await page.reload({ waitUntil: 'networkidle0' });

            //Incident Timeline is now directly below 'BASIC' tab and it does not have 'Prev' and 'Next' button.

            await init.pageWaitForSelector(page, '.internal-list');

            const incidentTimelineRow = await init.page$$(
                page,
                '.internal-list'
            );
            const countIncidentTimelines = incidentTimelineRow.length;
            expect(countIncidentTimelines).toEqual(11); // An internal mesage has been exist in the previous test
        },
        init.timeout
    );

    test(
        'should show the incident timeline when an incident is acknowledged',
        async () => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details

            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#AcknowledgeText_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.reload({ waitUntil: 'networkidle0' });
            // Incident Timeline Tab Does Not Exist Anymore

            await init.pageWaitForSelector(page, '.internal-list');

            const incidentTimelineRows = await init.page$$(
                page,
                '.internal-list'
            );
            const countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(11);
        },

        operationTimeOut
    );

    test(
        'should show the incident timeline when an incident is resolved',
        async () => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details

            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName}`
            );

            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#btnResolve_0');

            await init.pageClick(page, '#btnResolve_0');

            await init.pageWaitForSelector(page, '#ResolveText_0');
            // Incident Timeline Tab Does Not Exist Anymore

            await init.pageWaitForSelector(page, '.internal-list');

            const incidentTimelineRows = await init.page$$(
                page,
                '.internal-list'
            );
            const countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(11);
        },

        operationTimeOut
    );
});
