const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const user1 = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

let browser, page;

describe('Incident Created test', () => {
    const operationTimeOut = init.timeout;

    const monitorName = utils.generateRandomString();
    const monitorName2 = utils.generateRandomString();

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Rearranging it makes the 'user' automatically logged in after registrations
        await init.registerUser(user1, page);
        await init.logout(page);
        await init.registerUser(user, page);
    });

    afterAll(async () => {
        await browser.close();
    });

    it(
        'it should not show the close all button when no resolve incident',
        async () => {
            const projectName = 'Project1';
            const componentName = 'HomePage';

            await page.goto(utils.DASHBOARD_URL);
            // Rename project
            await init.pageWaitForSelector(page, '#projectSettings');
            await page.$eval('#projectSettings', e => e.click());
            await init.pageWaitForSelector(page, 'input[name=project_name]');
            await init.pageClick(page, 'input[name=project_name]', {
                clickCount: 3,
            });
            await init.pageType(page, 'input[name=project_name]', projectName);
            await init.pageWaitForSelector(page, 'button[id=btnCreateProject]');
            await page.$eval('button[id=btnCreateProject]', e => e.click());
            await init.pageWaitForSelector(page, `#cb${projectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName,
                page,
                componentName
            );
            await init.addIncident(monitorName, 'Degraded', page, 'Low');
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await page.$eval('button[id=viewIncident-0]', e => e.click());
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());
            await page.goto(utils.DASHBOARD_URL);
            const closeAllButton = await init.pageWaitForSelector(page, 
                '#incidents-close-all-btn',
                { hidden: true }
            );
            expect(closeAllButton).toBe(null);
        },
        operationTimeOut
    );
    it(
        'it should show close all incident button on the homepage when any there are resolved incidents',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await page.$eval('#btnResolve_0', e => e.click());
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: init.timeout,
            });
            const closeAllButton = await init.pageWaitForSelector(page, 
                '#incidents-close-all-btn',
                { visible: true, timeout: init.timeout }
            );
            expect(closeAllButton).toBeDefined();
        },
        operationTimeOut
    );
    it(
        'should close all resolved incident on the homepage',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#incidents-close-all-btn');
            await page.$eval('#incidents-close-all-btn', elem => elem.click());
            const closeButton = await init.pageWaitForSelector(page, 
                '#closeIncidentButton_0',
                {
                    hidden: true,
                }
            );
            expect(closeButton).toBeNull();
        },
        operationTimeOut
    );
    test(
        'Should show a pop up when an incident is created',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.addIncident(monitorName, 'Degraded', page, 'Low');

            const viewIncidentButton = await init.pageWaitForSelector(page, 
                'button[id=viewIncident-0]',
                { visible: true, timeout: init.timeout }
            );
            expect(viewIncidentButton).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'Should not show incident popup for acknowledged incidents',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';

            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await page.$eval('button[id=viewIncident-0]', e => e.click());
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());
            // await init.pageWaitForSelector(page, '#ResolveText_0', { visible: true, timeout: init.timeout });
            await page.goto(utils.DASHBOARD_URL);

            // Invite member on the project
            await init.pageWaitForSelector(page, '#teamMembers');
            await page.$eval('#teamMembers', e => e.click());
            await init.pageWaitForSelector(page, `#btn_${projectName}`);
            await page.$eval(`#btn_${projectName}`, e => e.click());
            await init.pageWaitForSelector(page, 'input[name=emails]');
            await init.pageType(page, 'input[name=emails]', user1.email);
            await init.pageWaitForSelector(page, `#${role}_${projectName}`);
            await page.$eval(`#${role}_${projectName}`, e => e.click());
            await page.$eval(`#btn_modal_${projectName}`, e => e.click());
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`, {
                hidden: true,
            });

            await init.logout(page);
            await init.loginUser(user1, page);
            // Switch projects
            await init.switchProject(projectName, page);
            const viewIncidentButton = await page.$(
                'button[id=viewIncident-0]'
            );
            expect(viewIncidentButton).toBe(null);
            await init.logout(page);
            await init.loginUser(user, page);
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await page.$eval('#btnResolve_0', e => e.click());
        },
        operationTimeOut
    );
    test(
        'Should not show incident popup for resolved incidents',
        async () => {
            const projectName = 'Project1';

            await init.addIncident(monitorName, 'Degraded', page, 'Low');
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await page.$eval('button[id=viewIncident-0]', e => e.click());
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await page.$eval('#btnResolve_0', e => e.click());
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.goto(utils.DASHBOARD_URL);

            await init.logout(page);
            await init.loginUser(user1, page);
            // Switch projects
            await init.switchProject(projectName, page);
            const viewIncidentButton = await page.$(
                'button[id=viewIncident-0]'
            );
            expect(viewIncidentButton).toBe(null);
            await init.logout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    test(
        'Should show the incident created pop up to other team members',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL);

            await init.addIncident(monitorName, 'Degraded', page, 'Low');
            await init.logout(page);
            await init.loginUser(user1, page);
            // Switch projects
            await init.switchProject(projectName, page);
            const viewIncidentButton = await init.pageWaitForSelector(page, 
                'button[id=viewIncident-0]',
                { visible: true, timeout: init.timeout }
            );
            expect(viewIncidentButton).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'Should navigate to incident detail page when the view button is clicked',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#components', e => e.click());

            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await page.$eval('button[id=viewIncident-0]', e => e.click());
            await init.pageWaitForSelector(page, '#cbIncident', {
                visible: true,
                timeout: init.timeout,
            });
            let pageTitle = await page.$('#cbIncident');
            pageTitle = await pageTitle.getProperty('innerText');
            pageTitle = await pageTitle.jsonValue();
            pageTitle.should.be.exactly('Incident');
            expect(pageTitle).toBeDefined();
            await init.logout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    test(
        'Should close incident popup',
        async () => {
            await init.addIncident(monitorName, 'Offline', page, 'Low');
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#closeIncident_0', elem => elem.click());
            const closeButton = await init.pageWaitForSelector(page, '#closeIncident_0', {
                hidden: true,
            });
            expect(closeButton).toBeNull();
            await init.logout(page);
            await init.loginUser(user1, page);
        },
        operationTimeOut
    );

    test(
        'Should show closed incident to other team members',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL);
            await init.switchProject(projectName, page);

            const viewIncidentButton = await page.$(
                'button[id=viewIncident-0]'
            );
            expect(viewIncidentButton).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'Should show active incidents on the dashboard',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, 'span#activeIncidentsText', {
                visible: true,
                timeout: init.timeout,
            });
            let activeIncidents = await page.$('span#activeIncidentsText');
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('2 Incidents Currently Active');
            await init.logout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    test(
        'Should redirect to home page when active incidents is clicked',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            //Navigate to Integrations Page before clicking 'activeIncidents' to confirm it  truly navigates back to homepage.
            await init.pageWaitForSelector(page, '#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#integrations');
            await init.pageClick(page, '#integrations');

            await init.pageWaitForSelector(page, '#activeIncidents');
            await page.$eval('#activeIncidents', e => e.click());
            await init.pageWaitForSelector(page, '#cbHome');
            let activeIncidents = await page.$('#cbHome', {
                visible: true,
                timeout: init.timeout,
            });
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual('Home');
            await init.logout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    test(
        'Should filter unacknowledged incidents',
        async () => {
            await init.addIncident(monitorName, 'Online', page, 'Low');
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await page.$eval('button[id=viewIncident-0]', elem => elem.click());

            // Acknowledge this incident
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());

            await init.pageWaitForSelector(page, '#backToMonitorView');
            await page.$eval('#backToMonitorView', e => e.click());

            await init.pageWaitForSelector(page, 'button[id=filterToggle]');
            await page.$eval('button[id=filterToggle]', e => e.click());
            await init.pageWaitForSelector(page, 'div[title=unacknowledged]');
            await page.$eval('div[title=unacknowledged]', e => e.click());

            await init.pageWaitForSelector(page, 'tr.incidentListItem');
            const filteredIncidents = await page.$$('tr.incidentListItem');
            const filteredIncidentsCount = filteredIncidents.length;

            expect(filteredIncidentsCount).toEqual(2);
        },
        operationTimeOut
    );

    test(
        'Should display a message if there are no incidents to display after filtering',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#incidents');
            await page.$eval('#incidents', e => e.click());

            // Acknowledge the second incident
            await init.pageWaitForSelector(page, `tr#incident_${monitorName}_1`);
            await page.$eval(`tr#incident_${monitorName}_1`, e => e.click());
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());

            await init.pageWaitForSelector(page, '#backToDashboard');
            await page.$eval('#backToDashboard', e => e.click());
            await init.pageWaitForSelector(page, '#incidents');
            await page.$eval('#incidents', e => e.click());

            // Acknowledge the third incident
            await init.pageWaitForSelector(page, `tr#incident_${monitorName}_2`);
            await page.$eval(`tr#incident_${monitorName}_2`, e => e.click());
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await page.$eval('#btnAcknowledge_0', e => e.click());

            await init.pageWaitForSelector(page, '#backToDashboard');
            await page.$eval('#backToDashboard', e => e.click());
            await init.pageWaitForSelector(page, '#incidents');
            await page.$eval('#incidents', e => e.click());

            await init.pageWaitForSelector(page, 'button[id=filterToggle]');
            await page.$eval('button[id=filterToggle]', e => e.click());
            await init.pageWaitForSelector(page, 'div[title=unacknowledged]');
            await page.$eval('div[title=unacknowledged]', e => e.click());

            let filteredIncidents = await page.$('span#noIncidentsInnerText');
            filteredIncidents = await filteredIncidents.getProperty(
                'innerText'
            );
            filteredIncidents = await filteredIncidents.jsonValue();

            expect(filteredIncidents).toEqual('No incidents to display');
        },
        operationTimeOut
    );

    test(
        'Should filter unresolved incidents',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components');
            await page.$eval('#components', e => e.click());

            await init.pageWaitForSelector(page, 
                `button[id=view-resource-${monitorName}]`
            );
            await page.$eval(`button[id=view-resource-${monitorName}]`, e =>
                e.click()
            );

            await init.pageWaitForSelector(page, 'button[id=filterToggle]');
            await page.$eval('button[id=filterToggle]', e => e.click());
            await init.pageWaitForSelector(page, 'div[title=unresolved]');
            await page.$eval('div[title=unresolved]', e => e.click());

            await init.pageWaitForSelector(page, 'tr.incidentListItem');
            const filteredIncidents = await page.$$('tr.incidentListItem');
            const filteredIncidentsCount = filteredIncidents.length;

            expect(filteredIncidentsCount).toEqual(3);
        },
        operationTimeOut
    );

    test(
        'Should clear filters',
        async () => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components');
            await page.$eval('#components', e => e.click());

            await init.pageWaitForSelector(page, 
                `button[id=view-resource-${monitorName}]`
            );
            await page.$eval(`button[id=view-resource-${monitorName}]`, e =>
                e.click()
            );

            await init.pageWaitForSelector(page, 'button[id=filterToggle]');
            await page.$eval('button[id=filterToggle]', e => e.click());
            await init.pageWaitForSelector(page, 'div[title=clear]');
            await page.$eval('div[title=clear]', e => e.click());

            await init.pageWaitForSelector(page, 'tr.incidentListItem');
            const filteredIncidents = await page.$$('tr.incidentListItem');
            const filteredIncidentsCount = filteredIncidents.length;

            expect(filteredIncidentsCount).toEqual(5);
        },
        operationTimeOut
    );

    test(
        'Should show incidents of different components on the incident logs menu',
        async () => {
            const componentName = 'NewComponent';

            await page.goto(utils.DASHBOARD_URL);
            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName2,
                page,
                componentName
            );
            await init.addIncident(monitorName2, 'Offline', page, 'High');
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#incidents');
            await page.$eval('#incidents', e => e.click());
            await init.pageWaitForSelector(page, 'tr.incidentListItem');
            const filteredIncidents = await page.$$('tr.incidentListItem');
            const filteredIncidentsCount = filteredIncidents.length;
            expect(filteredIncidentsCount).toEqual(7);
        },
        operationTimeOut
    );

    test(
        'Should create an incident from the incident logs page and add it to the incident list',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#incidents');
            await page.$eval('#incidents', e => e.click());
            await init.pageWaitForSelector(page, `#btnCreateIncident_${projectName}`);
            await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#frmIncident');
            await init.selectByText('#componentList', 'NewComponent', page);
            await init.selectByText('#monitorList', monitorName2, page);
            await init.selectByText('#incidentTypeId', 'Degraded', page);
            await init.selectByText('#incidentPriority', 'Low', page);
            await page.$eval('#createIncident', e => e.click());
            await init.pageWaitForSelector(page, '#createIncident', { hidden: true });
            await init.pageWaitForSelector(page, 'tr.incidentListItem');
            const filteredIncidents = await page.$$('tr.incidentListItem');
            const filteredIncidentsCount = filteredIncidents.length;
            expect(filteredIncidentsCount).toEqual(8);
        },
        operationTimeOut
    );

    // test(
    //     'Should open modal for unresolved incident when close button is clicked',
    //     async () => {
    //
    //             await page.goto(utils.DASHBOARD_URL);
    //             await init.pageWaitForSelector(page, '#closeIncident_0', {
    //                 visible: true,
    //             });
    //             await page.$eval('#closeIncident_0', elem => elem.click());
    //             await init.pageWaitForSelector(page, '#closeIncidentButton_0');
    //             await page.$eval('#closeIncidentButton_0',e=>e.click());
    //             const elementHandle = await page.$('#modal-ok');
    //             expect(elementHandle).not.toBe(null);
    //         });
    //     },
    //     operationTimeOut
    // );

    test(
        'Should close incident notification when an incident is viewed',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL);
            // remove existing notification
            await init.pageWaitForSelector(page, '#incidents');
            await page.$eval('#incidents', e => e.click());
            await init.pageWaitForSelector(page, `#btnCreateIncident_${projectName}`);
            await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#frmIncident');
            await init.selectByText('#componentList', 'NewComponent', page);
            await init.selectByText('#monitorList', monitorName2, page);
            await init.selectByText('#incidentTypeId', 'Online', page);
            await init.selectByText('#incidentPriority', 'Low', page);
            await page.$eval('#createIncident', e => e.click());
            await init.pageWaitForSelector(page, '#createIncident', { hidden: true });
            await page.goto(utils.DASHBOARD_URL);
            await page.$eval(`#${monitorName2}_ViewIncidentDetails`, elem =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '#closeIncident_2', {
                hidden: true,
            });
            const rowsCount = (await page.$$('#notificationscroll button'))
                .length;

            expect(rowsCount).toEqual(2);
        },
        operationTimeOut
    );
});
