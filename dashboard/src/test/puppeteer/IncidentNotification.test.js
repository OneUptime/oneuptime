const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

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

describe('Incident Created test', () => {
    const operationTimeOut = 500000;

    let cluster;
    const monitorName = utils.generateRandomString();
    const monitorName2 = utils.generateRandomString();

    beforeAll(async () => {
        jest.setTimeout(500000);

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
        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            await init.registerUser(user1, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should show a pop up when an incident is created',
        async () => {
            const projectName = 'Project1';
            const componentName = 'HomePage';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                // Rename project
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('input[name=project_name]');
                await page.click('input[name=project_name]', { clickCount: 3 });
                await page.type('input[name=project_name]', projectName);
                await page.waitForSelector('button[id=btnCreateProject]');
                await page.click('button[id=btnCreateProject]');

                await init.addComponent(componentName, page);
                await init.addMonitorToComponent(
                    null,
                    monitorName,
                    page,
                    componentName
                );
                await init.addIncident(monitorName, 'Degraded', page, 'Low');
                const viewIncidentButton = await page.waitForSelector(
                    'button[id=viewIncident-0]',
                    { visible: true }
                );
                expect(viewIncidentButton).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should not show incident popup for resolved incidemnts',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('button[id=viewIncident-0]');
                await page.click('button[id=viewIncident-0]');
                await page.waitForSelector('#btnResolve_0');
                await page.click('#btnResolve_0');
                await page.waitForSelector('#ResolveText_0', { visible: true });
                await page.goto(utils.DASHBOARD_URL);

                // Invite member on the project
                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${projectName}`);
                await page.click(`#btn_${projectName}`);
                await page.waitForSelector('input[name=emails]');
                await page.click('input[name=emails]');
                await page.type('input[name=emails]', user1.email);
                await page.waitForSelector(`#${role}_${projectName}`);
                await page.click(`#${role}_${projectName}`);
                await page.click(`#btn_modal_${projectName}`);
                await page.waitForSelector(`#btn_modal_${projectName}`, {
                    hidden: true,
                });

                await init.logout(page);
                await init.loginUser(user1, page);
                // Switch projects
                await init.switchProject(projectName, page);
                const viewIncidentButton = await page.$(
                    'button[id=viewIncident-0]',
                    { visible: true }
                );
                expect(viewIncidentButton).toBe(null);
                await init.logout(page);
                await init.loginUser(user, page);
            });
        },
        operationTimeOut
    );

    test(
        'Should show the incident created pop up to other team members',
        async () => {
            const projectName = 'Project1';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await init.addIncident(monitorName, 'Degraded', page, 'Low');
                await init.logout(page);
                await init.loginUser(user1, page);
                // Switch projects
                await init.switchProject(projectName, page);
                const viewIncidentButton = await page.waitForSelector(
                    'button[id=viewIncident-0]',
                    { visible: true }
                );
                expect(viewIncidentButton).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to incident detail page when the view button is clicked',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                await page.waitForSelector('button[id=viewIncident-0]');
                await page.click('button[id=viewIncident-0]');
                await page.waitForSelector('#cbIncident', { visible: true });
                let pageTitle = await page.$('#cbIncident');
                pageTitle = await pageTitle.getProperty('innerText');
                pageTitle = await pageTitle.jsonValue();
                pageTitle.should.be.exactly('Incident');
                expect(pageTitle).toBeDefined();
                await init.logout(page);
                await init.loginUser(user, page);
            });
        },
        operationTimeOut
    );

    test(
        'Should close incident popup',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.addIncident(monitorName, 'Offline', page, 'Low');
                await page.waitForSelector('#closeIncident_0', {
                    visible: true,
                });
                await page.$eval('#closeIncident_0', elem => elem.click());
                const closeButton = await page.waitForSelector(
                    '#closeIncident_0',
                    { hidden: true }
                );
                expect(closeButton).toBeNull();
                await init.logout(page);
                await init.loginUser(user1, page);
            });
        },
        operationTimeOut
    );

    test(
        'Should show closed incident to other team members',
        async () => {
            const projectName = 'Project1';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await init.switchProject(projectName, page);

                const viewIncidentButton = await page.$(
                    'button[id=viewIncident-0]'
                );
                expect(viewIncidentButton).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should show active incidents on the dashboard',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('span#activeIncidentsText', {
                    visible: true,
                });
                let activeIncidents = await page.$('span#activeIncidentsText', {
                    visible: true,
                });
                activeIncidents = await activeIncidents.getProperty(
                    'innerText'
                );
                activeIncidents = await activeIncidents.jsonValue();
                expect(activeIncidents).toEqual('2 Incidents Currently Active');
                await init.logout(page);
                await init.loginUser(user, page);
            });
        },
        operationTimeOut
    );

    test(
        'Should redirect to home page when active incidents is clicked',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#activeIncidents');
                await page.click('#activeIncidents');
                await page.waitForSelector('#cbHome');
                let activeIncidents = await page.$('#cbHome', {
                    visible: true,
                });
                activeIncidents = await activeIncidents.getProperty(
                    'innerText'
                );
                activeIncidents = await activeIncidents.jsonValue();
                expect(activeIncidents).toEqual('Home');
                await init.logout(page);
                await init.loginUser(user, page);
            });
        },
        operationTimeOut
    );

    test(
        'Should filter unacknowledged incidents',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.addIncident(monitorName, 'Online', page, 'Low');
                await page.waitForSelector('button[id=viewIncident-0]');
                await page.$eval('button[id=viewIncident-0]', elem =>
                    elem.click()
                );

                // Acknowledge this incident
                await page.waitForSelector('#btnAcknowledge_0');
                await page.click('#btnAcknowledge_0');

                await page.waitForSelector('#backToMonitorView');
                await page.click('#backToMonitorView');

                await page.waitForSelector('button[id=filterToggle]');
                await page.click('button[id=filterToggle]');
                await page.waitForSelector('div[title=unacknowledged]');
                await page.click('div[title=unacknowledged]');

                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;

                expect(filteredIncidentsCount).toEqual(2);
            });
        },
        operationTimeOut
    );

    test(
        'Should display a message if there are no incidents to display after filtering',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#incidents');
                await page.click('#incidents');

                // Acknowledge the second incident
                await page.waitForSelector(`tr#incident_${monitorName}_1`);
                await page.click(`tr#incident_${monitorName}_1`);
                await page.waitForSelector('#btnAcknowledge_0');
                await page.click('#btnAcknowledge_0');

                await page.waitForSelector('#backToDashboard');
                await page.click('#backToDashboard');
                await page.waitForSelector('#incidents');
                await page.click('#incidents');

                // Acknowledge the third incident
                await page.waitForSelector(`tr#incident_${monitorName}_2`);
                await page.click(`tr#incident_${monitorName}_2`);
                await page.waitForSelector('#btnAcknowledge_0');
                await page.click('#btnAcknowledge_0');

                await page.waitForSelector('#backToDashboard');
                await page.click('#backToDashboard');
                await page.waitForSelector('#incidents');
                await page.click('#incidents');

                await page.waitForSelector('button[id=filterToggle]');
                await page.click('button[id=filterToggle]');
                await page.waitForSelector('div[title=unacknowledged]');
                await page.click('div[title=unacknowledged]');

                let filteredIncidents = await page.$(
                    'span#noIncidentsInnerText'
                );
                filteredIncidents = await filteredIncidents.getProperty(
                    'innerText'
                );
                filteredIncidents = await filteredIncidents.jsonValue();

                expect(filteredIncidents).toEqual('No incidents to display');
            });
        },
        operationTimeOut
    );

    test(
        'Should filter unresolved incidents',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components');
                await page.click('#components');

                await page.waitForSelector(
                    `button[id=view-resource-${monitorName}]`
                );
                await page.click(`button[id=view-resource-${monitorName}]`);

                await page.waitForSelector('button[id=filterToggle]');
                await page.click('button[id=filterToggle]');
                await page.waitForSelector('div[title=unresolved]');
                await page.click('div[title=unresolved]');

                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;

                expect(filteredIncidentsCount).toEqual(3);
            });
        },
        operationTimeOut
    );

    test(
        'Should clear filters',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components');
                await page.click('#components');

                await page.waitForSelector(
                    `button[id=view-resource-${monitorName}]`
                );
                await page.click(`button[id=view-resource-${monitorName}]`);

                await page.waitForSelector('button[id=filterToggle]');
                await page.click('button[id=filterToggle]');
                await page.waitForSelector('div[title=clear]');
                await page.click('div[title=clear]');

                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;

                expect(filteredIncidentsCount).toEqual(4);
            });
        },
        operationTimeOut
    );

    test(
        'Should show incidents of different components on the incident logs menu',
        async () => {
            const componentName = 'NewComponent';
            return await cluster.execute(null, async ({ page }) => {
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

                await page.waitForSelector('#incidents');
                await page.click('#incidents');
                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;
                expect(filteredIncidentsCount).toEqual(5);
            });
        },
        operationTimeOut
    );

    test(
        'Should create an incident from the incident logs page and add it to the incident list',
        async () => {
            const projectName = 'Project1';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#closeIncident_0', {
                    visible: true,
                });
                await page.$eval('#closeIncident_0', elem => elem.click());
                await page.waitForSelector('#incidents');
                await page.click('#incidents');
                await page.waitForSelector(`#btnCreateIncident_${projectName}`);
                await page.click(`#btnCreateIncident_${projectName}`);
                await page.waitForSelector('#frmIncident');
                await init.selectByText('#monitorList', monitorName2, page);
                await init.selectByText('#incidentTypeId', 'Degraded', page);
                await init.selectByText('#incidentPriority', 'Low', page);
                await page.click('#createIncident');
                await page.waitForSelector('#createIncident', { hidden: true });
                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;
                expect(filteredIncidentsCount).toEqual(6);
            });
        },
        operationTimeOut
    );

    test(
        'Should open modal for unresolved incident when close button is clicked',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#closeIncident_0', {
                    visible: true,
                });
                await page.$eval('#closeIncident_0', elem => elem.click());
                await page.waitForSelector('#closeIncidentButton_0');
                await page.click('#closeIncidentButton_0');
                const elementHandle = await page.$('#modal-ok');
                expect(elementHandle).not.toBe(null);
            });
        },
        operationTimeOut
    );

    test(
        'Should close incident notification when an incident is viewed',
        async () => {
            const projectName = 'Project1';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#incidents');
                await page.click('#incidents');
                await page.waitForSelector(`#btnCreateIncident_${projectName}`);
                await page.click(`#btnCreateIncident_${projectName}`);
                await page.waitForSelector('#frmIncident');
                await init.selectByText('#monitorList', monitorName2, page);
                await init.selectByText('#incidentTypeId', 'Online', page);
                await init.selectByText('#incidentPriority', 'Low', page);
                await page.click('#createIncident');
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval(
                    `button[id=${monitorName2}_ViewIncidentDetails]`,
                    elem => elem.click()
                );
                const closeButton = await page.waitForSelector(
                    '#closeIncident_0',
                    { hidden: true }
                );
                expect(closeButton).toBeNull();
            });
        },
        operationTimeOut
    );
});
