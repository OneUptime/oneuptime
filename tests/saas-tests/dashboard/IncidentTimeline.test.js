const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let browser, page;
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

        const user = {
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
        await page.waitForSelector('#form-new-monitor', { visible: true });
        await page.$eval('input[id=name]', e => e.click());
        await init.pageType(page, 'input[id=name]', projectMonitorName);
        await init.pageClick(page, '[data-testId=type_url]');
        await page.waitForSelector('#url', { visible: true });
        await page.$eval('#url', e => e.click());
        await init.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
        await page.$eval('button[type=submit]', e => e.click());
        await page.waitForSelector(`#monitor-title-${projectMonitorName}`, {
            visible: true,
        });
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should create incident in project and add to message to the incident message thread',
        async done => {
            
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector(
                    `#create_incident_${projectMonitorName}`
                );
                await init.pageClick(
                    page,
                    `#create_incident_${projectMonitorName}`
                );
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await init.selectByText('#incidentPriority', 'High', page);
                await init.pageType(page, '#title', 'new incident');
                await page.waitForSelector('#createIncident');
                await init.pageClick(page, '#createIncident');
                await page.waitForSelector('#createIncident', { hidden: true });

                // navigate to monitor details
                await page.waitForSelector(
                    `#more-details-${projectMonitorName}`
                );
                await init.pageClick(
                    page,
                    `#more-details-${projectMonitorName}`
                );

                await page.waitForSelector(
                    `#incident_${projectMonitorName}_0`,
                    { visible: true }
                );
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );
                //Incident Notes Tab has been refactored. It functionality is now in 'Incident Timeline' which is below the BASIC tab.

                // fill investigation message thread form
                await page.waitForSelector(`#add-${type}-message`, {
                    visible: true,
                });
                await init.pageClick(page, `#add-${type}-message`);
                await page.waitForSelector(
                    `#form-new-incident-${type}-message`
                );
                await init.pageType(
                    page,
                    `textarea[id=new-${type}]`,
                    `${message}`
                );
                await init.selectByText(
                    '#incident_state',
                    'investigating',
                    page
                );
                await init.pageClick(page, `#${type}-addButton`);
                await page.waitForSelector(`#${type}-addButton`, {
                    hidden: true,
                });

                await page.waitForSelector(
                    `#content_${type}_incident_message_0`,
                    { visible: true }
                );
                const investigationMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await investigationMessage.getProperty(
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
        async done => {
            
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                // navigate to monitor details
                await page.waitForSelector(
                    `#more-details-${projectMonitorName}`,
                    { visible: true }
                );
                await init.pageClick(
                    page,
                    `#more-details-${projectMonitorName}`
                );

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );

                //Incident Notes Tab has been refactored. It functionality is now in 'Incident Timeline' which is below the BASIC tab.

                await page.waitForSelector(`#edit_${type}_incident_message_0`);
                await init.pageClick(page, `#edit_${type}_incident_message_0`);

                // edit investigation message thread form
                await page.waitForSelector(`#edit-${type}`);
                await init.pageClick(page, `textarea[id=edit-${type}]`);
                await init.pageType(
                    page,
                    `textarea[id=edit-${type}]`,
                    '-updated'
                );
                await init.selectByText('#incident_state', 'update', page);
                await init.pageClick(page, 'button[type=submit]');
                await page.waitForSelector(`#${type}-editButton`, {
                    hidden: true,
                });
                await page.reload({ waitUntil: 'networkidle0' });
                //Incident Notes Tab has been refactored. It functionality is now in 'Incident Timeline' which is below the BASIC tab.
                await page.waitForSelector(
                    `#content_${type}_incident_message_0`,
                    { visible: true }
                );
                const investigationMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await investigationMessage.getProperty(
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
        async done => {
            
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                // navigate to monitor details
                await page.waitForSelector(
                    `#more-details-${projectMonitorName}`,
                    { visible: true }
                );
                await init.pageClick(
                    page,
                    `#more-details-${projectMonitorName}`
                );

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );
                // fill internal message thread form
                await page.waitForSelector(`#add-${type}-message`);
                await page.$eval(`#add-${type}-message`, e => e.click());
                await page.waitForSelector(
                    `#form-new-incident-${type}-message`
                );
                await init.pageClick(page, `textarea[id=new-${type}]`);
                await init.pageType(
                    page,
                    `textarea[id=new-${type}]`,
                    `${message}`
                );
                await init.selectByText('#incident_state', 'others', page);
                await init.pageClick(page, 'input[name=custom_incident_state]');
                await init.pageType(
                    page,
                    'input[name=custom_incident_state]',
                    'automation'
                );

                await init.pageClick(page, `#${type}-addButton`);
                await page.waitForSelector(`#${type}-addButton`, {
                    hidden: true,
                });

                await page.waitForSelector(
                    `#content_${type}_incident_message_0`,
                    { visible: true }
                );
                const incidentMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await incidentMessage.getProperty(
                    'innerText'
                );
                messageContent = await messageContent.jsonValue();

                expect(messageContent).toMatch(`${message}`);
           

            done();
        },
        operationTimeOut
    );
    test(
        'should edit message related to internal incident message thread',
        async done => {
            
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                // navigate to monitor details
                await page.waitForSelector(
                    `#more-details-${projectMonitorName}`,
                    { visible: true }
                );
                await init.pageClick(
                    page,
                    `#more-details-${projectMonitorName}`
                );

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );
                // click on incident notes tab
                await init.gotoTab(utils.incidentTabIndexes.BASIC, page);

                await page.waitForSelector(`#edit_${type}_incident_message_0`);
                await init.pageClick(page, `#edit_${type}_incident_message_0`);

                // edit investigation message thread form
                await page.waitForSelector(`#${type}-editButton`);
                await init.pageClick(page, `textarea[id=edit-${type}]`);
                await init.pageType(
                    page,
                    `textarea[id=edit-${type}]`,
                    '-updated'
                );
                await init.selectByText(
                    '#incident_state',
                    'investigating',
                    page
                );
                await init.pageClick(page, `#${type}-editButton`);
                await page.waitForSelector(`#${type}-editButton`, {
                    hidden: true,
                });
                await page.reload({ waitUntil: 'networkidle0' });

                await page.waitForSelector(
                    `#content_${type}_incident_message_0`,
                    { visible: true }
                );
                const incidentMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await incidentMessage.getProperty(
                    'innerText'
                );
                messageContent = await messageContent.jsonValue();
                expect(messageContent).toEqual(`${message}-updated`);
        

            done();
        },
        operationTimeOut
    );
    test(
        'should delete message related to internal incident message thread',
        async done => {
            
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                // navigate to monitor details
                await page.waitForSelector(
                    `#more-details-${projectMonitorName}`
                );
                await init.pageClick(
                    page,
                    `#more-details-${projectMonitorName}`
                );

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );

                await page.waitForSelector(
                    `#delete_${type}_incident_message_0`
                );
                await init.pageClick(
                    page,
                    `#delete_${type}_incident_message_0`
                );

                // click confirmation delete button
                await page.waitForSelector('#deleteIncidentMessage');
                await init.pageClick(page, '#deleteIncidentMessage');
                await page.waitForSelector('#deleteIncidentMessage', {
                    hidden: true,
                });

                const incidentMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                expect(incidentMessage).toEqual(null);
           

            done();
        },
        operationTimeOut
    );

    test('should get incident timeline and paginate for incident timeline in project', async () => {
        //
        const internalNote = utils.generateRandomString();
        const type = 'internal';
        // Navigate to Component details
        await init.navigateToComponentDetails(componentName, page);

        // navigate to monitor details
        await page.waitForSelector(`#more-details-${projectMonitorName}`);
        await init.pageClick(page, `#more-details-${projectMonitorName}`);

        await page.waitForSelector(`#incident_${projectMonitorName}_0`);
        await page.$eval(`#incident_${projectMonitorName}_0`, e => e.click());
        for (let i = 0; i < 10; i++) {
            // add internal note
            await page.waitForSelector(`#add-${type}-message`, {
                visible: true,
            });
            await init.pageClick(page, `#add-${type}-message`);
            await page.waitForSelector(`#form-new-incident-${type}-message`);
            await init.pageClick(page, `textarea[id=new-${type}]`);
            await init.pageType(
                page,
                `textarea[id=new-${type}]`,
                `${internalNote}`
            );
            await init.selectByText('#incident_state', 'update', page);

            await init.pageClick(page, `#${type}-addButton`);
            await page.waitForSelector(`#${type}-addButton`, {
                hidden: true,
            });
        }
        await page.reload({ waitUntil: 'networkidle0' });

        //Incident Timeline is now directly below 'BASIC' tab and it does not have 'Prev' and 'Next' button.
        await page.waitForSelector('.internal-list');
        const incidentTimelineRow = await page.$$('.internal-list');
        const countIncidentTimelines = incidentTimelineRow.length;
        expect(countIncidentTimelines).toEqual(11); // An internal mesage has been exist in the previous test
    }, init.timeout);

    test(
        'should show the incident timeline when an incident is acknowledged',
        async () => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            // navigate to monitor details
            await page.waitForSelector(`#more-details-${projectMonitorName}`);
            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await page.waitForSelector(`#incident_${projectMonitorName}_0`);
            await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                e.click()
            );
            await page.waitForSelector('#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());
            await page.waitForSelector('#AcknowledgeText_0', {
                visible: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });
            // Incident Timeline Tab Does Not Exist Anymore
            await page.waitForSelector('.internal-list');
            const incidentTimelineRows = await page.$$('.internal-list');
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
            await page.waitForSelector(`#more-details-${projectMonitorName}`);
            await init.pageClick(page, `#more-details-${projectMonitorName}`);

            await page.waitForSelector(`#incident_${projectMonitorName}_0`);
            await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                e.click()
            );
            await page.waitForSelector('#btnResolve_0');
            await init.pageClick(page, '#btnResolve_0');
            await page.waitForSelector('#ResolveText_0');
            // Incident Timeline Tab Does Not Exist Anymore
            await page.waitForSelector('.internal-list');
            const incidentTimelineRows = await page.$$('.internal-list');
            const countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(11);
        },

        operationTimeOut
    );
});
