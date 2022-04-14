import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

// parent user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

// sub-project user credentials
const newUser: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const projectMonitorName = utils.generateRandomString();
const projectMonitorName1 = utils.generateRandomString();
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const newComponentName = utils.generateRandomString();
let browser: $TSFixMe, page: $TSFixMe;

describe('Incident API With SubProjects', () => {
    const operationTimeOut = init.timeout;

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
            // add sub-project
            await init.addSubProject(subProjectName, page);

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
            // Create Component
            await init.addComponent(componentName, page);
            await init.addAdditionalComponent(newComponentName, page);
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
            // await init.pageType(page, '#title', 'new incident');

            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle0',
                timeout: init.timeout,
            });

            // close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(
                page,
                `#incident_${projectMonitorName}_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const incidentTitleSelector = await init.page$(
                page,
                `#incident_${projectMonitorName}_title`
            );

            let textContent = await incidentTitleSelector.getProperty(
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

            const incidentTitleSelector = await init.pageWaitForSelector(
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
            // close incident modal
            const closeModal = await init.pageWaitForSelector(
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
                    (elem: $TSFixMe) => elem.click()
                );
            }

            // Navigate to details page of monitor

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
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
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            // await init.pageType(page, '#title', 'new incident');

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
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) =>
                elem.click()
            );

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

            const incidentTitleSelector = await init.page$(
                page,
                `#incident_${projectMonitorName1}_title`
            );

            let textContent = await incidentTitleSelector.getProperty(
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

            const acknowledgeTextSelector = await init.page$(
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

            const resolveTextSelector = await init.page$(
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
            const internalNote = utils.generateRandomString();

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
                (e: $TSFixMe) => e.click()
            );

            const type: string = 'internal';
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

            const internalMessage = await init.page$(
                page,
                `#content_${type}_incident_message_0`
            );
            let internalContent = await internalMessage.getProperty(
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

    // test(
    //     'should get incident timeline and paginate for incident timeline in sub-project',
    //     async done => {
    //         const internalNote = utils.generateRandomString();
    //         const  type: string = 'internal';
    //         await init.loginUser(newUser, page);
    //         // switch to invited project for new user
    //         await init.switchProject(projectName, page);
    //         // Navigate to Component details
    //         await init.navigateToMonitorDetails(
    //             componentName,
    //             projectMonitorName1,
    //             page
    //         );

    //         await init.pageWaitForSelector(page, `#incident_0`, {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.page$Eval(page, `#incident_0`, e => e.click());
    //         await init.pageWaitForSelector(page, '#incident_0', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         // click on incident notes tab
    //         await init.gotoTab(utils.incidentTabIndexes.BASIC, page);

    //         for (let i = 0; i < 10; i++) {
    //             await init.page$Eval(page, `#add-${type}-message`, e =>
    //                 e.click()
    //             );
    //             await init.pageWaitForSelector(
    //                 page,
    //                 `#form-new-incident-${type}-message`
    //             );
    //             await init.pageClick(page, `textarea[id=new-${type}]`);
    //             await init.pageType(
    //                 page,
    //                 `textarea[id=new-${type}]`,
    //                 `${internalNote}`
    //             );
    //             await init.selectDropdownValue(
    //                 '#incident_state',
    //                 'update',
    //                 page
    //             );
    //             await init.pageClick(page, `#${type}-addButton`);
    //             await init.pageWaitForSelector(page, `#${type}-addButton`, {
    //                 hidden: true,
    //             });
    //         }
    //         // click on incident timeline tab
    //         await init.gotoTab(
    //             utils.incidentTabIndexes.INCIDENT_TIMELINE,
    //             page
    //         );
    //         await page.reload({ waitUntil: 'networkidle0' });
    //         await init.gotoTab(
    //             utils.incidentTabIndexes.INCIDENT_TIMELINE,
    //             page
    //         );

    //         await init.pageWaitForSelector(
    //             page,
    //             '#incidentTimeline tr.incidentListItem',
    //             { visible: true, timeout: init.timeout }
    //         );
    //         let incidentTimelineRows = await init.page$$(
    //             page,
    //             '#incidentTimeline tr.incidentListItem'
    //         );
    //         let countIncidentTimelines = incidentTimelineRows.length;

    //         expect(countIncidentTimelines).toEqual(10);

    //         await init.page$Eval(page, '#btnTimelineNext', e => e.click());
    //         await init.pageWaitForSelector(page, '.ball-beat', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageWaitForSelector(page, '.ball-beat', {
    //             hidden: true,
    //         });
    //         incidentTimelineRows = await init.page$$(
    //             page,
    //             '#incidentTimeline tr.incidentListItem'
    //         );
    //         countIncidentTimelines = incidentTimelineRows.length;
    //         expect(countIncidentTimelines).toEqual(5);

    //         await init.page$Eval(page, '#btnTimelinePrev', e => e.click());
    //         await init.pageWaitForSelector(page, '.ball-beat', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageWaitForSelector(page, '.ball-beat', {
    //             hidden: true,
    //         });
    //         incidentTimelineRows = await init.page$$(
    //             page,
    //             '#incidentTimeline tr.incidentListItem'
    //         );
    //         countIncidentTimelines = incidentTimelineRows.length;
    //         expect(countIncidentTimelines).toEqual(10);
    //         await init.logout(page);
    //         done();
    //     },
    //     operationTimeOut
    // );

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

            const incidentRows = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
            const countIncidents = incidentRows.length;
            expect(countIncidents).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );
});
