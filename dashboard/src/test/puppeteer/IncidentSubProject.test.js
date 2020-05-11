const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';

const projectName = utils.generateRandomString();
const projectMonitorName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

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

        // Register user
        const task = async ({ page, data }) => {
            await page.setDefaultTimeout(utils.timeout);
            const user = {
                email: data.email,
                password: data.password,
            };

            // user
            await init.registerUser(user, page, data.isParentUser);
            await init.loginUser(user, page);

            if (data.isParentUser) {
                // rename default project
                await init.renameProject(data.projectName, page);
                // add sub-project
                await init.addSubProject(data.subProjectName, page);
                // Create Component
                await init.addComponent(
                    componentName,
                    page,
                    data.subProjectName
                );
                // add new user to sub-project
                await init.addUserToProject(
                    {
                        email: data.newEmail,
                        role: 'Member',
                        subProjectName: data.subProjectName,
                    },
                    page
                );
                // add new monitor to parent project
                await init.addMonitorToSubProject(
                    data.projectMonitorName,
                    null,
                    componentName,
                    page
                );
                // add new monitor to sub-project
                await init.addMonitorToSubProject(
                    data.subProjectMonitorName,
                    data.subProjectName,
                    componentName,
                    page
                );
            }
        };

        await cluster.execute(
            {
                projectName,
                subProjectName,
                email,
                password,
                newEmail,
                projectMonitorName,
                subProjectMonitorName,
                isParentUser: true,
            },
            task
        );

        await cluster.execute(
            {
                projectName,
                subProjectName,
                email: newEmail,
                password: newPassword,
                isParentUser: false,
            },
            task
        );
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create an incident in parent project for valid `admin`',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                { email, password, projectMonitorName },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };
                    await init.loginUser(user, page);
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
                    const incidentTitleSelector = await page.$(
                        '#incident_span_0'
                    );

                    let textContent = await incidentTitleSelector.getProperty(
                        'innerText'
                    );
                    textContent = await textContent.jsonValue();
                    expect(textContent.toLowerCase()).toEqual(
                        `${projectMonitorName}'s Incident Status`.toLowerCase()
                    );
                }
            );
        },
        operationTimeOut
    );

    test(
        'should create an incident in sub-project for sub-project `member`',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                {
                    email: newEmail,
                    password: newPassword,
                    projectName,
                    subProjectMonitorName,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // switch to invited project for new user
                    await init.switchProject(data.projectName, page);
                    // Navigate to details page of monitor
                    await init.navigateToComponentDetails(componentName, page);
                    // create incident
                    await page.waitForSelector(
                        `#create_incident_${data.subProjectMonitorName}`
                    );
                    await page.click(
                        `#create_incident_${data.subProjectMonitorName}`
                    );
                    await page.waitForSelector('#createIncident');
                    await init.selectByText('#incidentType', 'Offline', page);
                    await page.click('#createIncident');
                    await page.waitForSelector('#incident_span_0');
                    const incidentTitleSelector = await page.$(
                        '#incident_span_0'
                    );

                    let textContent = await incidentTitleSelector.getProperty(
                        'innerText'
                    );
                    textContent = await textContent.jsonValue();
                    expect(textContent.toLowerCase()).toEqual(
                        `${subProjectMonitorName}'s Incident Status`.toLowerCase()
                    );
                }
            );
        },
        operationTimeOut
    );

    test(
        'should acknowledge incident in sub-project for sub-project `member`',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                {
                    email: newEmail,
                    password: newPassword,
                    projectName,
                    subProjectMonitorName,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // switch to invited project for new user
                    await init.switchProject(data.projectName, page);
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
                }
            );
        },
        operationTimeOut
    );

    test(
        'should resolve incident in sub-project for sub-project `member`',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                {
                    email: newEmail,
                    password: newPassword,
                    projectName,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // switch to invited project for new user
                    await init.switchProject(data.projectName, page);
                    // Navigate to details page of component created
                    await init.navigateToComponentDetails(componentName, page);
                    // resolve incident
                    await page.waitForSelector('#btnResolve_0');
                    await page.click('#btnResolve_0');
                    await page.waitForSelector('#ResolveText_0');

                    const resolveTextSelector = await page.$('#ResolveText_0');
                    expect(resolveTextSelector).not.toBeNull();
                }
            );
        },
        operationTimeOut
    );

    test(
        'should update internal and investigation notes of incident in sub-project',
        async () => {
            expect.assertions(2);
            const investigationNote = utils.generateRandomString();
            const internalNote = utils.generateRandomString();
            return await cluster.execute(
                {
                    email: newEmail,
                    password: newPassword,
                    subProjectMonitorName,
                    projectName,
                    internalNote,
                    investigationNote,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // switch to invited project for new user
                    await init.switchProject(data.projectName, page);
                    // Navigate to details page of component created
                    await init.navigateToComponentDetails(componentName, page);
                    // update internal note
                    await page.waitForSelector(
                        `#incident_${data.subProjectMonitorName}_0`
                    );
                    await page.click(
                        `#incident_${data.subProjectMonitorName}_0`
                    );
                    await page.waitForSelector('#txtInternalNote');
                    await page.type('#txtInternalNote', data.internalNote);
                    await page.click('#btnUpdateInternalNote');
                    await page.waitFor(5000);
                    await page.waitForSelector('#txtInvestigationNote');
                    await page.type(
                        '#txtInvestigationNote',
                        data.investigationNote
                    );
                    await page.click('#btnUpdateInvestigationNote');
                    await page.waitFor(5000);

                    const internalNoteSelector = await page.$(
                        '#txtInternalNote'
                    );
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
                }
            );
        },
        operationTimeOut
    );

    test('should get incident timeline and paginate for incident timeline in sub-project', async () => {
        expect.assertions(3);
        const internalNote = utils.generateRandomString();
        return await cluster.execute(
            {
                email: newEmail,
                password: newPassword,
                subProjectMonitorName,
                projectName,
                internalNote,
                counter: 0,
                limit: 10,
            },
            async ({ page, data }) => {
                await page.setDefaultTimeout(utils.timeout);
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);
                // switch to invited project for new user
                await init.switchProject(data.projectName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector(
                    `#incident_${data.subProjectMonitorName}_0`
                );
                await page.click(`#incident_${data.subProjectMonitorName}_0`);

                for (let i = 0; i < 10; i++) {
                    // update internal note
                    await page.waitForSelector('#txtInternalNote');
                    await page.type('#txtInternalNote', data.internalNote);
                    await page.click('#btnUpdateInternalNote');
                    await page.waitFor(5000);
                }

                let incidentTimelineRows = await page.$$('tr.incidentListItem');
                let countIncidentTimelines = incidentTimelineRows.length;

                expect(countIncidentTimelines).toEqual(10);

                const nextSelector = await page.$('#btnTimelineNext');

                await nextSelector.click();
                await page.waitFor(5000);
                incidentTimelineRows = await page.$$('tr.incidentListItem');
                countIncidentTimelines = incidentTimelineRows.length;
                expect(countIncidentTimelines).toEqual(5);

                const prevSelector = await page.$('#btnTimelinePrev');

                await prevSelector.click();
                await page.waitFor(5000);
                incidentTimelineRows = await page.$$('tr.incidentListItem');
                countIncidentTimelines = incidentTimelineRows.length;
                expect(countIncidentTimelines).toEqual(10);
            }
        );
    }, 200000);

    test('should get list of incidents and paginate for incidents in sub-project', async () => {
        expect.assertions(3);
        const paginate = async ({ page, data }) => {
            await page.setDefaultTimeout(utils.timeout);
            const user = {
                email: data.email,
                password: data.password,
            };

            await init.loginUser(user, page);
            // switch to invited project for new user
            await init.switchProject(data.projectName, page);
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);

            for (let i = 0; i < 10; i++) {
                await init.addIncidentToProject(
                    data.subProjectMonitorName,
                    data.subProjectName,
                    page
                );
            }

            let incidentRows = await page.$$('tr.incidentListItem');
            let countIncidents = incidentRows.length;

            expect(countIncidents).toEqual(10);

            const nextSelector = await page.$('#btnNext');

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
        };

        return await cluster.execute(
            {
                email: newEmail,
                password: newPassword,
                subProjectMonitorName,
                subProjectName,
                projectName,
                counter: 0,
                limit: 10,
            },
            paginate
        );
    }, 500000);
});
