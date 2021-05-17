const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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
const projectMonitorName1 = utils.generateRandomString();
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const newComponentName = utils.generateRandomString();
let browser, page;
describe('Incident API With SubProjects', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        await init.logout(page);
        await init.registerUser(newUser, page);
        await init.logout(page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should create an incident in parent project for valid `admin`',
        async () => {
            await init.loginUser(user, page);
            await init.addGrowthProject(projectName, page);

            // add sub-project
            await init.addSubProject(subProjectName, page);
            // Create Component
            await init.addComponent(componentName, page, subProjectName);
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
            // This navigates to component details as well as creates monitor
            // add new montor to parent project
            await init.addNewMonitorToComponent(
                page,
                componentName,
                projectMonitorName
            );
            // add new monitor to sub-project
            await init.addNewMonitorToComponent(
                page,
                componentName,
                projectMonitorName1
            );

            // Navigate to details page of monitor
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(
                page,
                `#create_incident_${projectMonitorName}`,
                { visible: true, timeout: init.timeout }
            );
            await init.pageClick(
                page,
                `#create_incident_${projectMonitorName}`
            );
            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectByText('#incidentType', 'Offline', page);
            await init.pageType(page, '#title', 'new incident');
            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            // close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#closeIncident_0', elem => elem.click());

            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });
            const incidentTitleSelector = await page.$(
                '#incident_0  .bs-font-header'
            );

            let textContent = await incidentTitleSelector.getProperty(
                'innerText'
            );
            textContent = await textContent.jsonValue();
            expect(textContent.toLowerCase()).toEqual(
                `${projectMonitorName} is offline`.toLowerCase()
            );
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should not display created incident status in a different component',
        async () => {
            await init.loginUser(user, page);
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // Navigate to details page of monitor
            await init.navigateToComponentDetails(newComponentName, page);

            const incidentTitleSelector = await page.$(
                '#incident_0 .bs-font-header'
            );
            expect(incidentTitleSelector).toBeNull();
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should create an incident in sub-project for sub-project `member`',
        async () => {
            await init.loginUser(newUser, page);
            // switch to invited project for new user
            await init.switchProject(projectName, page);

            // close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#closeIncident_0', elem => elem.click());

            // Navigate to details page of monitor
            await init.navigateToComponentDetails(componentName, page);
            // create incident
            await init.pageWaitForSelector(
                page,
                `#create_incident_${projectMonitorName1}`
            );
            await init.pageClick(
                page,
                `#create_incident_${projectMonitorName1}`
            );
            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectByText('#incidentType', 'Offline', page);
            await init.pageType(page, '#title', 'new incident');
            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });
            // close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#closeIncident_0', elem => elem.click());

            await init.pageWaitForSelector(page, '#incident_1');
            const incidentTitleSelector = await page.$(
                '#incident_0 .bs-font-header'
            );

            let textContent = await incidentTitleSelector.getProperty(
                'innerText'
            );
            textContent = await textContent.jsonValue();
            expect(textContent.toLowerCase()).toEqual(
                `${projectMonitorName1} is offline`.toLowerCase()
            );
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should acknowledge incident in sub-project for sub-project `member`',
        async () => {
            await init.loginUser(newUser, page);
            // switch to invited project for new user
            await init.switchProject(projectName, page);
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);
            // acknowledge incident
            await init.pageWaitForSelector(page, '#btnAcknowledge_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#btnAcknowledge_0');
            await init.pageWaitForSelector(page, '#AcknowledgeText_0', {
                visible: true,
                timeout: operationTimeOut,
            });

            const acknowledgeTextSelector = await page.$('#AcknowledgeText_0');
            expect(acknowledgeTextSelector).toBeDefined();
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should resolve incident in sub-project for sub-project `member`',
        async () => {
            await init.loginUser(newUser, page);
            // switch to invited project for new user
            await init.switchProject(projectName, page);
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);
            // resolve incident
            await init.pageWaitForSelector(page, '#btnResolve_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#btnResolve_0');
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: operationTimeOut,
            });

            const resolveTextSelector = await page.$('#ResolveText_0');
            expect(resolveTextSelector).toBeDefined();
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should update internal and investigation notes of incident in sub-project',
        async () => {
            const investigationNote = utils.generateRandomString();
            const internalNote = utils.generateRandomString();
            await init.loginUser(newUser, page);
            // switch to invited project for new user
            await init.switchProject(projectName, page);
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(
                page,
                `#incident_${projectMonitorName1}_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await page.$eval(`#incident_${projectMonitorName1}_0`, e =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });

            // click on incident notes tab
            await init.gotoTab(utils.incidentTabIndexes.BASIC, page);

            let type = 'internal';
            // fill internal message thread form
            await init.pageWaitForSelector(page, `#add-${type}-message`);
            await page.$eval(`#add-${type}-message`, e => e.click());
            await init.pageWaitForSelector(
                page,
                `#form-new-incident-${type}-message`
            );
            await init.pageClick(page, `textarea[id=new-${type}]`);
            await init.pageType(page, `textarea[id=new-${type}]`, internalNote);
            await init.selectByText('#incident_state', 'investigating', page);
            await init.pageClick(page, `#${type}-addButton`);
            await init.pageWaitForSelector(page, `#${type}-addButton`, {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });
            // click on incident notes tab
            await init.gotoTab(utils.incidentTabIndexes.BASIC, page);

            const internalMessage = await page.$(
                `#content_${type}_incident_message_0`
            );
            let internalContent = await internalMessage.getProperty(
                'innerText'
            );

            internalContent = await internalContent.jsonValue();
            expect(internalContent).toEqual(internalNote);

            type = 'investigation';
            await init.gotoTab(utils.incidentTabIndexes.INCIDENT_NOTES, page);
            // fill investigation message thread form
            await init.pageWaitForSelector(page, `#add-${type}-message`);
            await page.$eval(`#add-${type}-message`, e => e.click());
            await init.pageWaitForSelector(
                page,
                `#form-new-incident-${type}-message`
            );
            await init.pageClick(page, `textarea[id=new-${type}]`);
            await init.pageType(
                page,
                `textarea[id=new-${type}]`,
                investigationNote
            );
            await init.selectByText('#incident_state', 'investigating', page);
            await init.pageClick(page, `#${type}-addButton`);
            await init.pageWaitForSelector(page, `#${type}-addButton`, {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });
            // click on incident notes tab
            await init.gotoTab(utils.incidentTabIndexes.INCIDENT_NOTES, page);

            const investigationMessage = await page.$(
                `#content_${type}_incident_message_0`
            );
            let investigationContent = await investigationMessage.getProperty(
                'innerText'
            );

            investigationContent = await investigationContent.jsonValue();
            expect(investigationContent).toEqual(`${investigationNote}`);
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should get incident timeline and paginate for incident timeline in sub-project',
        async () => {
            const internalNote = utils.generateRandomString();
            const type = 'internal';
            await init.loginUser(newUser, page);
            // switch to invited project for new user
            await init.switchProject(projectName, page);
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(
                page,
                `#incident_${projectMonitorName1}_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await page.$eval(`#incident_${projectMonitorName1}_0`, e =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });
            // click on incident notes tab
            await init.gotoTab(utils.incidentTabIndexes.BASIC, page);

            for (let i = 0; i < 10; i++) {
                await page.$eval(`#add-${type}-message`, e => e.click());
                await init.pageWaitForSelector(
                    page,
                    `#form-new-incident-${type}-message`
                );
                await init.pageClick(page, `textarea[id=new-${type}]`);
                await init.pageType(
                    page,
                    `textarea[id=new-${type}]`,
                    `${internalNote}`
                );
                await init.selectByText('#incident_state', 'update', page);
                await init.pageClick(page, `#${type}-addButton`);
                await init.pageWaitForSelector(page, `#${type}-addButton`, {
                    hidden: true,
                });
            }
            // click on incident timeline tab
            await init.gotoTab(
                utils.incidentTabIndexes.INCIDENT_TIMELINE,
                page
            );
            await page.reload({ waitUntil: 'networkidle0' });
            await init.gotoTab(
                utils.incidentTabIndexes.INCIDENT_TIMELINE,
                page
            );

            await init.pageWaitForSelector(
                page,
                '#incidentTimeline tr.incidentListItem',
                { visible: true, timeout: init.timeout }
            );
            let incidentTimelineRows = await page.$$(
                '#incidentTimeline tr.incidentListItem'
            );
            let countIncidentTimelines = incidentTimelineRows.length;

            expect(countIncidentTimelines).toEqual(10);

            await page.$eval('#btnTimelineNext', e => e.click());
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            incidentTimelineRows = await page.$$(
                '#incidentTimeline tr.incidentListItem'
            );
            countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(5);

            await page.$eval('#btnTimelinePrev', e => e.click());
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            incidentTimelineRows = await page.$$(
                '#incidentTimeline tr.incidentListItem'
            );
            countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(10);
            await init.logout(page);
        },
        operationTimeOut
    );

    test(
        'should get list of incidents and paginate for incidents in sub-project',
        async () => {
            await init.loginUser(newUser, page);
            // switch to invited project for new user
            await init.switchProject(projectName, page);
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);

            await init.addIncidentToProject(
                projectMonitorName1,
                subProjectName,
                page
            );

            await init.pageWaitForSelector(page, 'tr.incidentListItem', {
                visible: true,
                timeout: init.timeout,
            });
            const incidentRows = await page.$$('tr.incidentListItem');
            const countIncidents = incidentRows.length;
            expect(countIncidents).toEqual(2);
            await init.logout(page);
        },
        operationTimeOut
    );
});
