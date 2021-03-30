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
            // Rearranging it makes the 'user' automaticaaly logged in after registrations
            await init.registerUser(user1, page);
            await init.logout(page);
            await init.registerUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    it(
        'it should not show the close all button when no resolve incident',
        async () => {
            const projectName = 'Project1';
            const componentName = 'HomePage';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                // Rename project
                await page.waitForSelector('#projectSettings');
                await page.$eval('#projectSettings', e => e.click());
                await page.waitForSelector('input[name=project_name]');
                await page.click('input[name=project_name]', { clickCount: 3 });
                await page.type('input[name=project_name]', projectName);
                await page.waitForSelector('button[id=btnCreateProject]');
                await page.$eval('button[id=btnCreateProject]', e => e.click());
                await page.waitForSelector(`#cb${projectName}`, {
                    visible: true,
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
                await page.waitForSelector('button[id=viewIncident-0]');
                await page.$eval('button[id=viewIncident-0]', e => e.click());
                await page.waitForSelector('#btnAcknowledge_0');
                await page.$eval('#btnAcknowledge_0', e => e.click());
                await page.goto(utils.DASHBOARD_URL);
                const closeAllButton = await page.waitForSelector(
                    '#incidents-close-all-btn',
                    { hidden: true }
                );
                expect(closeAllButton).toBe(null);
            });
        },
        operationTimeOut
    );
    it(
        'it should show close all incident button on the homepage when any there are resolved incidents',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#btnResolve_0');
                await page.$eval('#btnResolve_0', e => e.click());
                await page.waitForSelector('#ResolveText_0', { visible: true });
                const closeAllButton = await page.waitForSelector(
                    '#incidents-close-all-btn',
                    { visible: true }
                );
                expect(closeAllButton).toBeDefined();
            });
        },
        operationTimeOut
    );
    it(
        'should close all resolved incident on the homepage',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#incidents-close-all-btn');
                await page.$eval('#incidents-close-all-btn', elem =>
                    elem.click()
                );
                const closeButton = await page.waitForSelector(
                    '#closeIncidentButton_0',
                    {
                        hidden: true,
                    }
                );
                expect(closeButton).toBeNull();
            });
        },
        operationTimeOut
    );
    test(
        'Should show a pop up when an incident is created',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
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
        'Should not show incident popup for acknowledged incidents',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('button[id=viewIncident-0]');
                await page.$eval('button[id=viewIncident-0]', e => e.click());
                await page.waitForSelector('#btnAcknowledge_0');
                await page.$eval('#btnAcknowledge_0', e => e.click());
                // await page.waitForSelector('#ResolveText_0', { visible: true });
                await page.goto(utils.DASHBOARD_URL);

                // Invite member on the project
                await page.waitForSelector('#teamMembers');
                await page.$eval('#teamMembers', e => e.click());
                await page.waitForSelector(`#btn_${projectName}`);
                await page.$eval(`#btn_${projectName}`, e => e.click());
                await page.waitForSelector('input[name=emails]');
                await page.type('input[name=emails]', user1.email);
                await page.waitForSelector(`#${role}_${projectName}`);
                await page.$eval(`#${role}_${projectName}`, e => e.click());
                await page.$eval(`#btn_modal_${projectName}`, e => e.click());
                await page.waitForSelector(`#btn_modal_${projectName}`, {
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
                await page.waitForSelector('#btnResolve_0');
                await page.$eval('#btnResolve_0', e => e.click());
            });
        },
        operationTimeOut
    );
    test(
        'Should not show incident popup for resolved incidents',
        async () => {
            const projectName = 'Project1';
            return await cluster.execute(null, async ({ page }) => {
                await init.addIncident(monitorName, 'Degraded', page, 'Low');
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('button[id=viewIncident-0]');
                await page.$eval('button[id=viewIncident-0]', e => e.click());
                await page.waitForSelector('#btnAcknowledge_0');
                await page.$eval('#btnAcknowledge_0', e => e.click());
                await page.waitForSelector('#btnResolve_0');
                await page.$eval('#btnResolve_0', e => e.click());
                await page.waitForSelector('#ResolveText_0', { visible: true });
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
                await page.$eval('#components', e => e.click());

                await page.waitForSelector('button[id=viewIncident-0]');
                await page.$eval('button[id=viewIncident-0]', e => e.click());
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
                let activeIncidents = await page.$('span#activeIncidentsText');
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
                //Navigate to Integrations Page before clicking 'activeIncidents' to confirm it  truly navigates back to homepage.
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#integrations');
                await page.click('#integrations');

                await page.waitForSelector('#activeIncidents');
                await page.$eval('#activeIncidents', e => e.click());
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
                await page.$eval('#btnAcknowledge_0', e => e.click());

                await page.waitForSelector('#backToMonitorView');
                await page.$eval('#backToMonitorView', e => e.click());

                await page.waitForSelector('button[id=filterToggle]');
                await page.$eval('button[id=filterToggle]', e => e.click());
                await page.waitForSelector('div[title=unacknowledged]');
                await page.$eval('div[title=unacknowledged]', e => e.click());

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
                await page.$eval('#incidents', e => e.click());

                // Acknowledge the second incident
                await page.waitForSelector(`tr#incident_${monitorName}_1`);
                await page.$eval(`tr#incident_${monitorName}_1`, e =>
                    e.click()
                );
                await page.waitForSelector('#btnAcknowledge_0');
                await page.$eval('#btnAcknowledge_0', e => e.click());

                await page.waitForSelector('#backToDashboard');
                await page.$eval('#backToDashboard', e => e.click());
                await page.waitForSelector('#incidents');
                await page.$eval('#incidents', e => e.click());

                // Acknowledge the third incident
                await page.waitForSelector(`tr#incident_${monitorName}_2`);
                await page.$eval(`tr#incident_${monitorName}_2`, e =>
                    e.click()
                );
                await page.waitForSelector('#btnAcknowledge_0');
                await page.$eval('#btnAcknowledge_0', e => e.click());

                await page.waitForSelector('#backToDashboard');
                await page.$eval('#backToDashboard', e => e.click());
                await page.waitForSelector('#incidents');
                await page.$eval('#incidents', e => e.click());

                await page.waitForSelector('button[id=filterToggle]');
                await page.$eval('button[id=filterToggle]', e => e.click());
                await page.waitForSelector('div[title=unacknowledged]');
                await page.$eval('div[title=unacknowledged]', e => e.click());

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
                await page.$eval('#components', e => e.click());

                await page.waitForSelector(
                    `button[id=view-resource-${monitorName}]`
                );
                await page.$eval(`button[id=view-resource-${monitorName}]`, e =>
                    e.click()
                );

                await page.waitForSelector('button[id=filterToggle]');
                await page.$eval('button[id=filterToggle]', e => e.click());
                await page.waitForSelector('div[title=unresolved]');
                await page.$eval('div[title=unresolved]', e => e.click());

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
                await page.$eval('#components', e => e.click());

                await page.waitForSelector(
                    `button[id=view-resource-${monitorName}]`
                );
                await page.$eval(`button[id=view-resource-${monitorName}]`, e =>
                    e.click()
                );

                await page.waitForSelector('button[id=filterToggle]');
                await page.$eval('button[id=filterToggle]', e => e.click());
                await page.waitForSelector('div[title=clear]');
                await page.$eval('div[title=clear]', e => e.click());

                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;

                expect(filteredIncidentsCount).toEqual(5);
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
                await page.$eval('#incidents', e => e.click());
                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;
                expect(filteredIncidentsCount).toEqual(7);
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
                await page.waitForSelector('#incidents');
                await page.$eval('#incidents', e => e.click());
                await page.waitForSelector(`#btnCreateIncident_${projectName}`);
                await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                    e.click()
                );
                await page.waitForSelector('#frmIncident');
                await init.selectByText('#componentList', 'NewComponent', page);
                await init.selectByText('#monitorList', monitorName2, page);
                await init.selectByText('#incidentTypeId', 'Degraded', page);
                await init.selectByText('#incidentPriority', 'Low', page);
                await page.$eval('#createIncident', e => e.click());
                await page.waitForSelector('#createIncident', { hidden: true });
                await page.waitForSelector('tr.incidentListItem');
                const filteredIncidents = await page.$$('tr.incidentListItem');
                const filteredIncidentsCount = filteredIncidents.length;
                expect(filteredIncidentsCount).toEqual(8);
            });
        },
        operationTimeOut
    );

    // test(
    //     'Should open modal for unresolved incident when close button is clicked',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             await page.goto(utils.DASHBOARD_URL);
    //             await page.waitForSelector('#closeIncident_0', {
    //                 visible: true,
    //             });
    //             await page.$eval('#closeIncident_0', elem => elem.click());
    //             await page.waitForSelector('#closeIncidentButton_0');
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
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                // remove existing notification
                await page.waitForSelector('#incidents');
                await page.$eval('#incidents', e => e.click());
                await page.waitForSelector(`#btnCreateIncident_${projectName}`);
                await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                    e.click()
                );
                await page.waitForSelector('#frmIncident');
                await init.selectByText('#componentList', 'NewComponent', page);
                await init.selectByText('#monitorList', monitorName2, page);
                await init.selectByText('#incidentTypeId', 'Online', page);
                await init.selectByText('#incidentPriority', 'Low', page);
                await page.$eval('#createIncident', e => e.click());
                await page.waitForSelector('#createIncident', { hidden: true });
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval(`#${monitorName2}_ViewIncidentDetails`, elem =>
                    elem.click()
                );
                await page.waitForSelector('#closeIncident_2', {
                    hidden: true,
                });
                const rowsCount = (await page.$$('#notificationscroll button'))
                    .length;

                expect(rowsCount).toEqual(2);
            });
        },
        operationTimeOut
    );
});
