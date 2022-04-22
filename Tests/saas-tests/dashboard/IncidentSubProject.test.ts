import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

// Parent user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

// Sub-project user credentials
const newUser: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const projectMonitorName: string = utils.generateRandomString();
const projectMonitorName1: string = utils.generateRandomString();
const subProjectName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();
const newComponentName: string = utils.generateRandomString();
let browser: $TSFixMe, page: $TSFixMe;

describe('Incident API With SubProjects', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        await init.growthPlanUpgrade(page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should create an incident in parent project for valid `admin`',
        async (done: $TSFixMe) => {
            // Add sub-project
            await init.addSubProject(subProjectName, page);

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
            // Create Component
            await init.addComponent(componentName, page);
            await init.addAdditionalComponent(newComponentName, page);
            await page.goto(utils.DASHBOARD_URL);
            // Add new user to sub-project

            await init.addUserToProject(
                {
                    email: newUser.email,
                    role: 'Member',
                    subProjectName,
                },
                page
            );
            /*
             * This navigates to component details as well as creates monitor
             * Add new montor to parent project
             */
            await init.addNewMonitorToComponent(
                page,
                componentName,
                projectMonitorName
            );
            // Add new monitor to sub-project
            await init.addAdditionalMonitorToComponent(
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
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            // Await init.pageType(page, '#title', 'new incident');

            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle0',
                timeout: init.timeout,
            });

            // Close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) => {
                return elem.click();
            });

            await init.pageWaitForSelector(
                page,
                `#incident_${projectMonitorName}_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const incidentTitleSelector: $TSFixMe = await init.page$(
                page,
                `#incident_${projectMonitorName}_title`
            );

            let textContent: $TSFixMe = await incidentTitleSelector.getProperty(
                'innerText'
            );
            textContent = await textContent.jsonValue();
            expect(textContent.toLowerCase()).toEqual(
                `${projectMonitorName} is offline.`.toLowerCase()
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should not display created incident status in a different component',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // Navigate to details page of monitor
            await init.navigateToComponentDetails(newComponentName, page);

            const incidentTitleSelector: $TSFixMe =
                await init.pageWaitForSelector(
                    page,
                    `#incident_${projectMonitorName}_title`,
                    {
                        hidden: true,
                        timeout: init.timeout,
                    }
                );
            expect(incidentTitleSelector).toBeNull();
            await init.saasLogout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should create an incident in sub-project for sub-project `member`',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(newUser, page);
            // Close incident modal
            const closeModal: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#closeIncident_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            if (closeModal) {
                await init.page$Eval(
                    page,
                    '#closeIncident_0',
                    (elem: $TSFixMe) => {
                        return elem.click();
                    }
                );
            }

            // Navigate to details page of monitor

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
            await init.navigateToComponentDetails(componentName, page);
            // Create incident

            await init.pageWaitForSelector(
                page,
                `#create_incident_${projectMonitorName1}`
            );

            await init.pageClick(
                page,
                `#create_incident_${projectMonitorName1}`
            );

            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            // Await init.pageType(page, '#title', 'new incident');

            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });
            // Close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) => {
                return elem.click();
            });

            await init.pageWaitForSelector(
                page,
                `#more-details-${projectMonitorName1}`,
                {
                    visible: true,
                }
            );

            await init.pageClick(page, `#more-details-${projectMonitorName1}`);

            await init.pageWaitForSelector(
                page,
                `#incident_${projectMonitorName1}_title`,
                { visible: true }
            );

            const incidentTitleSelector: $TSFixMe = await init.page$(
                page,
                `#incident_${projectMonitorName1}_title`
            );

            let textContent: $TSFixMe = await incidentTitleSelector.getProperty(
                'innerText'
            );
            textContent = await textContent.jsonValue();
            expect(textContent.toLowerCase()).toEqual(
                `${projectMonitorName1} is offline.`.toLowerCase()
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should acknowledge incident in sub-project for sub-project `member`',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            await init.pageWaitForSelector(page, `#incident_0`);

            await init.pageClick(page, '#incident_0');

            // Acknowledge incident
            await init.pageWaitForSelector(page, '#btnAcknowledge_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnAcknowledge_0');
            await init.pageWaitForSelector(page, '#AcknowledgeText_0', {
                visible: true,
                timeout: operationTimeOut,
            });

            const acknowledgeTextSelector: $TSFixMe = await init.page$(
                page,
                '#AcknowledgeText_0'
            );
            expect(acknowledgeTextSelector).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should resolve incident in sub-project for sub-project `member`',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            await init.pageWaitForSelector(page, `#incident_0`);

            await init.pageClick(page, '#incident_0');

            // Resolve incident
            await init.pageWaitForSelector(page, '#btnResolve_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnResolve_0');
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: operationTimeOut,
            });

            const resolveTextSelector: $TSFixMe = await init.page$(
                page,
                '#ResolveText_0'
            );
            expect(resolveTextSelector).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should update internal and investigation notes of incident in sub-project (Postmortem notes)',
        async (done: $TSFixMe) => {
            const internalNote: string = utils.generateRandomString();

            // Navigate to details page of component created
            await init.navigateToMonitorDetails(
                componentName,
                projectMonitorName1,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#incident_${projectMonitorName1}_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.page$Eval(
                page,
                `#incident_${projectMonitorName1}_0`,
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            const type: string = 'internal';
            // Fill internal message thread form

            await init.pageWaitForSelector(page, `#add-${type}-message`);
            await init.page$Eval(
                page,
                `#add-${type}-message`,
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            await init.pageWaitForSelector(
                page,
                `#form-new-incident-${type}-message`
            );

            await init.pageClick(page, '#incident_description');

            await init.pageType(page, '#incident_description', internalNote);
            await init.selectDropdownValue(
                '#incident_state',
                'investigating',
                page
            );

            await init.pageClick(page, `#${type}-addButton`);
            await init.pageWaitForSelector(page, `#${type}-addButton`, {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });

            await init.pageWaitForSelector(
                page,
                `#content_${type}_incident_message_0`,
                {
                    visible: true,
                }
            );

            const internalMessage: $TSFixMe = await init.page$(
                page,
                `#content_${type}_incident_message_0`
            );
            let internalContent: $TSFixMe = await internalMessage.getProperty(
                'innerText'
            );

            internalContent = await internalContent.jsonValue();
            expect(internalContent).toEqual(internalNote);

            done();
        },
        operationTimeOut
    );

    /**
     * NOTE TO TEAM
     *
     * This particular test case is no longer needed in our codebase
     * If the need arises in the future, then we refactor this
     */

    /*
     * Test(
     *     'should get incident timeline and paginate for incident timeline in sub-project',
     *     Async (done: $TSFixMe) => {
     *         Const internalNote: string = utils.generateRandomString();
     *         Const  type: string = 'internal';
     *         Await init.loginUser(newUser, page);
     *         // switch to invited project for new user
     *         Await init.switchProject(projectName, page);
     *         // Navigate to Component details
     *         Await init.navigateToMonitorDetails(
     *             ComponentName,
     *             ProjectMonitorName1,
     *             Page
     *         );
     */

    /*
     *         Await init.pageWaitForSelector(page, `#incident_0`, {
     *             Visible: true,
     *             Timeout: init.timeout,
     *         });
     *         Await init.page$Eval(page, `#incident_0`, (e: $TSFixMe) => e.click());
     *         Await init.pageWaitForSelector(page, '#incident_0', {
     *             Visible: true,
     *             Timeout: init.timeout,
     *         });
     *         // click on incident notes tab
     *         Await init.gotoTab(utils.incidentTabIndexes.BASIC, page);
     */

    /*
     *         For (let i: $TSFixMe = 0; i < 10; i++) {
     *             Await init.page$Eval(page, `#add-${type}-message`, (e: $TSFixMe) =>
     *                 E.click()
     *             );
     *             Await init.pageWaitForSelector(
     *                 Page,
     *                 `#form-new-incident-${type}-message`
     *             );
     *             Await init.pageClick(page, `textarea[id=new-${type}]`);
     *             Await init.pageType(
     *                 Page,
     *                 `textarea[id=new-${type}]`,
     *                 `${internalNote}`
     *             );
     *             Await init.selectDropdownValue(
     *                 '#incident_state',
     *                 'update',
     *                 Page
     *             );
     *             Await init.pageClick(page, `#${type}-addButton`);
     *             Await init.pageWaitForSelector(page, `#${type}-addButton`, {
     *                 Hidden: true,
     *             });
     *         }
     *         // click on incident timeline tab
     *         Await init.gotoTab(
     *             Utils.incidentTabIndexes.INCIDENT_TIMELINE,
     *             Page
     *         );
     *         Await page.reload({ waitUntil: 'networkidle0' });
     *         Await init.gotoTab(
     *             Utils.incidentTabIndexes.INCIDENT_TIMELINE,
     *             Page
     *         );
     */

    /*
     *         Await init.pageWaitForSelector(
     *             Page,
     *             '#incidentTimeline tr.incidentListItem',
     *             { visible: true, timeout: init.timeout }
     *         );
     *         Let incidentTimelineRows: $TSFixMe = await init.page$$(
     *             Page,
     *             '#incidentTimeline tr.incidentListItem'
     *         );
     *         Let countIncidentTimelines: $TSFixMe = incidentTimelineRows.length;
     */

    //         Expect(countIncidentTimelines).toEqual(10);

    /*
     *         Await init.page$Eval(page, '#btnTimelineNext', (e: $TSFixMe) => e.click());
     *         Await init.pageWaitForSelector(page, '.ball-beat', {
     *             Visible: true,
     *             Timeout: init.timeout,
     *         });
     *         Await init.pageWaitForSelector(page, '.ball-beat', {
     *             Hidden: true,
     *         });
     *         IncidentTimelineRows = await init.page$$(
     *             Page,
     *             '#incidentTimeline tr.incidentListItem'
     *         );
     *         CountIncidentTimelines = incidentTimelineRows.length;
     *         Expect(countIncidentTimelines).toEqual(5);
     */

    /*
     *         Await init.page$Eval(page, '#btnTimelinePrev', (e: $TSFixMe) => e.click());
     *         Await init.pageWaitForSelector(page, '.ball-beat', {
     *             Visible: true,
     *             Timeout: init.timeout,
     *         });
     *         Await init.pageWaitForSelector(page, '.ball-beat', {
     *             Hidden: true,
     *         });
     *         IncidentTimelineRows = await init.page$$(
     *             Page,
     *             '#incidentTimeline tr.incidentListItem'
     *         );
     *         CountIncidentTimelines = incidentTimelineRows.length;
     *         Expect(countIncidentTimelines).toEqual(10);
     *         Await init.logout(page);
     *         Done();
     *     },
     *     OperationTimeOut
     * );
     */

    test(
        'should get list of incidents and paginate for incidents in sub-project',
        async (done: $TSFixMe) => {
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);
            await init.addIncidentToProject(
                projectMonitorName1,
                subProjectName,
                page
            );

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            await init.pageClick(page, '#btnAcknowledge_0');

            await init.pageClick(page, '#btnResolve_0');

            // Navigate to details page of component created
            await init.navigateToMonitorDetails(
                componentName,
                projectMonitorName1,
                page
            );

            await init.pageClick(
                page,
                `#createIncident_${projectMonitorName1}`
            );

            await init.pageClick(page, `#createIncident`);

            await init.pageWaitForSelector(page, 'tr.createdIncidentListItem', {
                visible: true,
                timeout: init.timeout,
            });

            const incidentRows: $TSFixMe = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
            const countIncidents: $TSFixMe = incidentRows.length;
            expect(countIncidents).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );
});
