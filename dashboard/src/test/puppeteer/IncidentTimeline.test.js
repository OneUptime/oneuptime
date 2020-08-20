const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const projectName = utils.generateRandomString();
const projectMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

const bodyText = utils.generateRandomString();
const message = utils.generateRandomString();

describe('Incident Timeline API', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);

            // rename default project
            await init.renameProject(projectName, page);

            // Create component
            await init.addComponent(componentName, page);
            // await init.navigateToComponentDetails(componentName, page);

            // add new monitor to project
            await page.waitForSelector('#monitors');
            await page.$eval('#monitors', e => e.click());
            await page.waitForSelector('#form-new-monitor');
            await page.$eval('input[id=name]', e => e.click());
            await page.type('input[id=name]', projectMonitorName);
            await init.selectByText('#type', 'url', page);
            await page.waitForSelector('#url');
            await page.$eval('#url', e => e.click());
            await page.type('#url', utils.HTTP_TEST_SERVER_URL);
            await page.$eval('button[type=submit]', e => e.click());
            await page.waitFor(2000);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create incident in project with multi-probes and add to incident timeline',
        async () => {
            expect.assertions(2);
            const testServer = async ({ page }) => {
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('body').value = '')
                );
                await page.waitForSelector('#responseTime');
                await page.$eval('input[name=responseTime]', e => e.click());
                await page.type('input[name=responseTime]', '0');
                await page.waitForSelector('#statusCode');
                await page.$eval('input[name=statusCode]', e => e.click());
                await page.type('input[name=statusCode]', '400');
                await page.select('#responseType', 'html');
                await page.waitForSelector('#body');
                await page.$eval('textarea[name=body]', e => e.click());
                await page.type(
                    'textarea[name=body]',
                    `<h1 id="html"><span>${bodyText}</span></h1>`
                );
                await page.$eval('button[type=submit]', e => e.click());
                await page.waitForSelector('#save-btn');
            };

            const dashboard = async ({ page }) => {
                await page.waitFor(350000);
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#incident_span_0');

                const incidentTitleSelector = await page.$('#incident_span_0');

                let textContent = await incidentTitleSelector.getProperty(
                    'innerText'
                );
                textContent = await textContent.jsonValue();
                expect(textContent.toLowerCase()).toEqual(
                    `${projectMonitorName}'s Incident Status`.toLowerCase()
                );

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );
                await page.waitFor(5000);

                const incidentTimelineRows = await page.$$(
                    '#incidentTimeline tr.incidentListItem'
                );
                const countIncidentTimelines = incidentTimelineRows.length;
                expect(countIncidentTimelines).toEqual(2);
            };

            await cluster.execute(null, testServer);
            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );

    test(
        'should auto-resolve incident in project with multi-probes and add to incident timeline',
        async () => {
            expect.assertions(2);
            const testServer = async ({ page }) => {
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings', {
                    waitUntil: 'networkidle2',
                });
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('body').value = '')
                );
                await page.waitForSelector('#responseTime');
                await page.$eval('input[name=responseTime]', e => e.click());
                await page.type('input[name=responseTime]', '0');
                await page.waitForSelector('#statusCode');
                await page.$eval('input[name=statusCode]', e => e.click());
                await page.type('input[name=statusCode]', '200');
                await page.select('#responseType', 'html');
                await page.waitForSelector('#body');
                await page.$eval('textarea[name=body]', e => e.click());
                await page.type(
                    'textarea[name=body]',
                    `<h1 id="html"><span>${bodyText}</span></h1>`
                );
                await page.$eval('button[type=submit]', e => e.click());
                await page.waitForSelector('#save-btn');
            };

            const dashboard = async ({ page }) => {
                await page.waitFor(350000);
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#ResolveText_0');

                const resolveTextSelector = await page.$('#ResolveText_0');
                expect(resolveTextSelector).not.toBeNull();

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                    e.click()
                );
                await page.waitFor(5000);

                const incidentTimelineRows = await page.$$(
                    '#incidentTimeline tr.incidentListItem'
                );
                const countIncidentTimelines = incidentTimelineRows.length;
                expect(countIncidentTimelines).toEqual(6);
            };

            await cluster.execute(null, testServer);
            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );
    test(
        'should create incident in project and add to message to the incident message thread',
        async () => {
            const dashboard = async ({ page }) => {
                await page.waitFor(5000);
                const type = 'investigation';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector(
                    `#more-details-${projectMonitorName}`
                );
                await page.click(`#more-details-${projectMonitorName}`);
                // create incident
                await page.waitForSelector(
                    `#monitorCreateIncident_${projectMonitorName}`
                );
                await page.click(
                    `#monitorCreateIncident_${projectMonitorName}`
                );
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.type('#title', 'new incident');
                await page.click('#createIncident');

                await page.waitFor(2000);
                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.click(`#incident_${projectMonitorName}_0`);
                await page.waitFor(2000);

                // fill investigation message thread form
                await page.waitFor(2000);
                await page.click(`#add-${type}-message`);
                await page.waitForSelector(
                    `#form-new-incident-${type}-message`
                );
                await page.click(`textarea[id=new-${type}]`);
                await page.type(`textarea[id=new-${type}]`, `${message}`);
                await init.selectByText(
                    '#incident_state',
                    'investigating',
                    page
                );
                await page.click(`#${type}-addButton`);
                await page.waitFor(2000);

                const investigationMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await investigationMessage.getProperty(
                    'innerText'
                );
                messageContent = await messageContent.jsonValue();
                expect(messageContent).toEqual(`${message}`);
            };

            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );
    test(
        'should edit message related to incident message thread',
        async () => {
            const dashboard = async ({ page }) => {
                await page.waitFor(5000);
                const type = 'investigation';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitFor(2000);

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.click(`#incident_${projectMonitorName}_0`);
                await page.waitFor(2000);

                await page.waitForSelector(`#edit_${type}_incident_message_0`);
                await page.click(`#edit_${type}_incident_message_0`);
                await page.waitFor(5000);

                // edit investigation message thread form
                await page.waitForSelector(`#edit-${type}`);
                await page.click(`textarea[id=edit-${type}]`);
                await page.type(`textarea[id=edit-${type}]`, '-updated');
                await init.selectByText('#incident_state', 'update', page);
                await page.click('button[type=submit]');
                await page.waitFor(2000);

                const investigationMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await investigationMessage.getProperty(
                    'innerText'
                );
                messageContent = await messageContent.jsonValue();
                expect(messageContent.substring(0, message.length + 8)).toEqual(
                    `${message}-updated`
                );
            };

            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );
    test(
        'should used existing incident and add to message to the internal incident message thread',
        async () => {
            const dashboard = async ({ page }) => {
                await page.waitFor(5000);
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitFor(2000);

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.click(`#incident_${projectMonitorName}_0`);
                await page.waitFor(2000);

                // fill internal message thread form
                await page.click(`#add-${type}-message`);
                await page.waitForSelector(
                    `#form-new-incident-${type}-message`
                );
                await page.click(`textarea[id=new-${type}]`);
                await page.type(`textarea[id=new-${type}]`, `${message}`);
                await init.selectByText('#incident_state', 'others', page);
                await page.click('input[name=custom_incident_state]');
                await page.type(
                    'input[name=custom_incident_state]',
                    'automation'
                );

                await page.click(`#${type}-addButton`);
                await page.waitFor(2000);

                const incidentMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await incidentMessage.getProperty(
                    'innerText'
                );
                messageContent = await messageContent.jsonValue();
                expect(messageContent).toEqual(`${message}`);
            };

            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );
    test(
        'should edit message related to internal incident message thread',
        async () => {
            const dashboard = async ({ page }) => {
                await page.waitFor(5000);
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitFor(2000);

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.click(`#incident_${projectMonitorName}_0`);
                await page.waitFor(2000);

                await page.waitForSelector(`#edit_${type}_incident_message_0`);
                await page.click(`#edit_${type}_incident_message_0`);
                await page.waitFor(5000);

                // edit investigation message thread form
                await page.waitForSelector(`#edit-${type}`);
                await page.click(`textarea[id=edit-${type}]`);
                await page.type(`textarea[id=edit-${type}]`, '-updated');
                await init.selectByText(
                    '#incident_state',
                    'investigating',
                    page
                );
                await page.click(`#${type}-editButton`);
                await page.waitFor(2000);

                const incidentMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                let messageContent = await incidentMessage.getProperty(
                    'innerText'
                );
                messageContent = await messageContent.jsonValue();
                expect(messageContent.substring(0, message.length + 8)).toEqual(
                    `${message}-updated`
                );
            };

            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );
    test(
        'should delete message related to internal incident message thread',
        async () => {
            const dashboard = async ({ page }) => {
                await page.waitFor(5000);
                const type = 'internal';
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitFor(2000);

                await page.waitForSelector(`#incident_${projectMonitorName}_0`);
                await page.click(`#incident_${projectMonitorName}_0`);
                await page.waitFor(2000);

                await page.waitForSelector(`#edit_${type}_incident_message_0`);
                await page.click(`#delete_${type}_incident_message_0`);
                await page.waitFor(5000);

                // click confirmation delete button
                await page.waitForSelector(`#deleteIncidentMessage`);
                await page.click(`#deleteIncidentMessage`);
                await page.waitFor(2000);

                const incidentMessage = await page.$(
                    `#content_${type}_incident_message_0`
                );
                expect(incidentMessage).toEqual(null);
            };

            await cluster.execute(null, dashboard);
        },
        operationTimeOut
    );

    test('should get incident timeline and paginate for incident timeline in project', async () => {
        expect.assertions(3);
        const internalNote = utils.generateRandomString();
        const type = 'internal';
        return await cluster.execute(null, async ({ page }) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            await page.waitFor(2000);

            await page.waitForSelector(`#incident_${projectMonitorName}_0`);
            await page.$eval(`#incident_${projectMonitorName}_0`, e =>
                e.click()
            );
            await page.waitFor(2000);

            for (let i = 0; i < 10; i++) {
                // add internal note
                await page.click(`#add-${type}-message`);
                await page.waitForSelector(
                    `#form-new-incident-${type}-message`
                );
                await page.click(`textarea[id=new-${type}]`);
                await page.type(`textarea[id=new-${type}]`, `${internalNote}`);
                await init.selectByText('#incident_state', 'update', page);

                await page.click(`#${type}-addButton`);
                await page.waitFor(2000);
            }

            await page.waitForSelector('#incidentTimeline tr.incidentListItem');
            let incidentTimelineRows = await page.$$(
                '#incidentTimeline tr.incidentListItem'
            );
            let countIncidentTimelines = incidentTimelineRows.length;

            expect(countIncidentTimelines).toEqual(10);

            const nextSelector = await page.$('#btnTimelineNext');
            await nextSelector.click();
            await page.waitFor(7000);
            incidentTimelineRows = await page.$$(
                '#incidentTimeline tr.incidentListItem'
            );
            countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(10);

            const prevSelector = await page.$('#btnTimelinePrev');
            await prevSelector.click();
            await page.waitFor(7000);
            incidentTimelineRows = await page.$$(
                '#incidentTimeline tr.incidentListItem'
            );
            countIncidentTimelines = incidentTimelineRows.length;
            expect(countIncidentTimelines).toEqual(10);
        });
    }, 300000);
});
