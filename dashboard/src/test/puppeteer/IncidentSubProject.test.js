const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

// sub-project user credentials
const newUser = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const projectName = utils.generateRandomString();
const projectMonitorName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const newComponentName = utils.generateRandomString();

describe('Incident API With SubProjects', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            await init.registerUser(newUser, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create an incident in parent project for valid `admin`',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#AccountSwitcherId', {
                    visible: true,
                });
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#create-project');
                await page.click('#create-project');
                await page.waitForSelector('#name');
                await page.type('#name', projectName);
                await page.waitFor(2000);
                await page.$$eval(
                    'input[name="planId"]',
                    inputs => inputs[2].click() // select Growth plan
                );
                await page.click('#btnCreateProject');
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                // add sub-project
                await init.addSubProject(subProjectName, page);
                // Create Component
                await init.addComponent(componentName, page, subProjectName);
                await page.goto(utils.DASHBOARD_URL);
                await init.addComponent(newComponentName, page, subProjectName);
                await page.goto(utils.DASHBOARD_URL);
                // add new user to sub-project
                await init.addUserToProject(
                    {
                        email: newUser.email,
                        role: 'Member',
                        subProjectName,
                    },
                    page
                );
                await init.navigateToComponentDetails(componentName, page);

                // add new monitor to parent project
                await init.addMonitorToSubProject(
                    projectMonitorName,
                    null,
                    componentName,
                    page
                );
                // add new monitor to sub-project
                await init.addMonitorToSubProject(
                    subProjectMonitorName,
                    subProjectName,
                    componentName,
                    page
                );

                // Navigate to details page of monitor
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector(
                    `#create_incident_${projectMonitorName}`
                );
                await page.click(`#create_incident_${projectMonitorName}`);
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.click('#createIncident');
                await page.waitForSelector('#incident_span_0');
                const incidentTitleSelector = await page.$('#incident_span_0');

                let textContent = await incidentTitleSelector.getProperty(
                    'innerText'
                );
                textContent = await textContent.jsonValue();
                expect(textContent.toLowerCase()).toEqual(
                    `${projectMonitorName}'s Incident Status`.toLowerCase()
                );
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should not display created incident status in a different component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // Navigate to details page of monitor
                await init.navigateToComponentDetails(newComponentName, page);

                const incidentTitleSelector = await page.$('#incident_span_0');
                expect(incidentTitleSelector).toBeNull();
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should create an incident in sub-project for sub-project `member`',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(newUser, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // switch to invited project for new user
                await init.switchProject(projectName, page);
                // Navigate to details page of monitor
                await init.navigateToComponentDetails(componentName, page);
                // create incident
                await page.waitForSelector(
                    `#create_incident_${subProjectMonitorName}`
                );
                await page.click(`#create_incident_${subProjectMonitorName}`);
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.click('#createIncident');
                await page.waitForSelector('#incident_span_0');
                const incidentTitleSelector = await page.$('#incident_span_0');

                let textContent = await incidentTitleSelector.getProperty(
                    'innerText'
                );
                textContent = await textContent.jsonValue();
                expect(textContent.toLowerCase()).toEqual(
                    `${subProjectMonitorName}'s Incident Status`.toLowerCase()
                );
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should acknowledge incident in sub-project for sub-project `member`',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(newUser, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // switch to invited project for new user
                await init.switchProject(projectName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                // acknowledge incident
                await page.waitForSelector('#btnAcknowledge_0');
                await page.click('#btnAcknowledge_0');
                await page.waitForSelector('#AcknowledgeText_0');

                const acknowledgeTextSelector = await page.$(
                    '#AcknowledgeText_0'
                );
                expect(acknowledgeTextSelector).not.toBeNull();
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should resolve incident in sub-project for sub-project `member`',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(newUser, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // switch to invited project for new user
                await init.switchProject(projectName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                // resolve incident
                await page.waitForSelector('#btnResolve_0');
                await page.click('#btnResolve_0');
                await page.waitForSelector('#ResolveText_0');

                const resolveTextSelector = await page.$('#ResolveText_0');
                expect(resolveTextSelector).not.toBeNull();
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should update internal and investigation notes of incident in sub-project',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                const investigationNote = utils.generateRandomString();
                const internalNote = utils.generateRandomString();
                await init.loginUser(newUser, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // switch to invited project for new user
                await init.switchProject(projectName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                // update internal note
                await page.waitForSelector(
                    `#incident_${subProjectMonitorName}_0`,
                    { visible: true }
                );
                await page.click(`#incident_${subProjectMonitorName}_0`);

                await page.waitForSelector('#txtInternalNote', {
                    visible: true,
                });
                await page.type('#txtInternalNote', internalNote);
                await page.waitForSelector('#btnUpdateInternalNote', {
                    visible: true,
                });
                await page.click('#btnUpdateInternalNote');
                await page.waitFor(5000);

                await page.waitForSelector('#txtInvestigationNote', {
                    visible: true,
                });
                await page.type('#txtInvestigationNote', investigationNote);
                await page.waitForSelector('#btnUpdateInvestigationNote', {
                    visible: true,
                });
                await page.click('#btnUpdateInvestigationNote');
                await page.waitFor(5000);
                const internalNoteSelector = await page.$('#txtInternalNote');
                let internalContent = await internalNoteSelector.getProperty(
                    'textContent'
                );

                internalContent = await internalContent.jsonValue();
                expect(internalContent).toEqual(internalNote);

                const investigationNoteSelector = await page.$(
                    '#txtInvestigationNote'
                );
                let investigationContent = await investigationNoteSelector.getProperty(
                    'textContent'
                );

                investigationContent = await investigationContent.jsonValue();
                expect(investigationContent).toEqual(investigationNote);
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should get incident timeline and paginate for incident timeline in sub-project',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                const internalNote = utils.generateRandomString();
                await init.loginUser(newUser, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // switch to invited project for new user
                await init.switchProject(projectName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                await page.waitFor(3000);

                await page.waitForSelector(
                    `#incident_${subProjectMonitorName}_0`
                );
                await page.click(`#incident_${subProjectMonitorName}_0`);

                for (let i = 0; i < 10; i++) {
                    // update internal note
                    await page.waitForSelector('#txtInternalNote', {
                        visible: true,
                    });
                    await page.type('#txtInternalNote', internalNote);
                    await page.click('#btnUpdateInternalNote');
                    await page.waitFor(2000);
                }
                let incidentTimelineRows = await page.$$('tr.incidentListItem');
                let countIncidentTimelines = incidentTimelineRows.length;

                expect(countIncidentTimelines).toEqual(10);

                const nextSelector = await page.$('#btnTimelineNext');
                await nextSelector.click();
                await page.waitFor(2000);
                incidentTimelineRows = await page.$$('tr.incidentListItem');
                countIncidentTimelines = incidentTimelineRows.length;
                expect(countIncidentTimelines).toEqual(5);

                const prevSelector = await page.$('#btnTimelinePrev');
                await prevSelector.click();
                await page.waitFor(2000);
                incidentTimelineRows = await page.$$('tr.incidentListItem');
                countIncidentTimelines = incidentTimelineRows.length;
                expect(countIncidentTimelines).toEqual(10);
                await init.logout(page);
            });
        },
        operationTimeOut
    );

    test(
        'should get list of incidents and paginate for incidents in sub-project',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(newUser, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // switch to invited project for new user
                await init.switchProject(projectName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                for (let i = 0; i < 10; i++) {
                    await init.addIncidentToProject(
                        subProjectMonitorName,
                        subProjectName,
                        page
                    );
                    await page.waitFor(2000);
                }

                let incidentRows = await page.$$('tr.incidentListItem');
                let countIncidents = incidentRows.length;
                expect(countIncidents).toEqual(10);

                const nextSelector = await page.$('#btnNext', {
                    visible: true,
                });
                await nextSelector.click();
                await page.waitFor(5000);
                incidentRows = await page.$$('tr.incidentListItem');
                countIncidents = incidentRows.length;
                expect(countIncidents).toEqual(1);

                const prevSelector = await page.$('#btnPrev');

                await prevSelector.click();
                await page.waitFor(5000);
                incidentRows = await page.$$('tr.incidentListItem');
                countIncidents = incidentRows.length;
                expect(countIncidents).toEqual(10);
                await init.logout(page);
            });
        },
        operationTimeOut
    );
});
