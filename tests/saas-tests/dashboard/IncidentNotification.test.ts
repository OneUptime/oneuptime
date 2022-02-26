// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

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

let browser: $TSFixMe, page: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incident Created test', () => {
    const operationTimeOut = init.timeout;

    const monitorName = utils.generateRandomString();
    const monitorName2 = utils.generateRandomString();

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Rearranging it makes the 'user' automatically logged in after registrations
        await init.registerUser(user1, page);
        await init.saasLogout(page);
        await init.registerUser(user, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'it should not show the close all button when no resolve incident',
        async () => {
            const projectName = 'Project1';
            const componentName = 'HomePage';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // Rename project
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            await init.page$Eval(page, '#projectSettings', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[name=project_name]');
            await init.pageClick(page, 'input[name=project_name]', {
                clickCount: 3,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=project_name]', projectName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[id=btnCreateProject]');
            await init.page$Eval(page, 'button[id=btnCreateProject]', (e: $TSFixMe) => e.click()
            );
            await init.pageWaitForSelector(page, `#cb${projectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName,
                page,
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 4.
                componentName
            );
            await init.addIncident(monitorName, 'Degraded', page, 'Low');
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await init.page$Eval(page, 'button[id=viewIncident-0]', (e: $TSFixMe) => e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            const closeAllButton = await init.pageWaitForSelector(
                page,
                '#incidents-close-all-btn',
                { hidden: true }
            );
            expect(closeAllButton).toBe(null);
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'it should show close all incident button on the homepage when any there are resolved incidents',
        async () => {
            // await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await init.page$Eval(page, '#btnResolve_0', (e: $TSFixMe) => e.click());
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: init.timeout,
            });
            const closeAllButton = await init.pageWaitForSelector(
                page,
                '#incidents-close-all-btn',
                { visible: true, timeout: init.timeout }
            );
            expect(closeAllButton).toBeDefined();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'should close all resolved incident on the homepage',
        async () => {
            // await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents-close-all-btn');
            await init.page$Eval(page, '#incidents-close-all-btn', (elem: $TSFixMe) => elem.click()
            );
            const closeButton = await init.pageWaitForSelector(
                page,
                '#closeIncidentButton_0',
                {
                    hidden: true,
                }
            );
            expect(closeButton).toBeNull();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show a pop up when an incident is created',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            await init.addIncident(monitorName, 'Degraded', page, 'Low');

            const viewIncidentButton = await init.pageWaitForSelector(
                page,
                'button[id=viewIncident-0]',
                { visible: true, timeout: init.timeout }
            );
            expect(viewIncidentButton).toBeDefined();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not show incident popup for acknowledged incidents',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await init.page$Eval(page, 'button[id=viewIncident-0]', (e: $TSFixMe) => e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());
            // await init.pageWaitForSelector(page, '#ResolveText_0', { visible: true, timeout: init.timeout });
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            // Invite member on the project
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#teamMembers');
            await init.page$Eval(page, '#teamMembers', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#btn_${projectName}`);
            await init.page$Eval(page, `#btn_${projectName}`, (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[name=emails]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=emails]', user1.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#${role}_${projectName}`);
            await init.page$Eval(page, `#${role}_${projectName}`, (e: $TSFixMe) => e.click()
            );
            await init.page$Eval(page, `#btn_modal_${projectName}`, (e: $TSFixMe) => e.click()
            );
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`, {
                hidden: true,
            });

            await init.saasLogout(page);
            await init.loginUser(user1, page);
            // Switch projects
            await init.switchProject(projectName, page);
            const viewIncidentButton = await init.page$(
                page,
                'button[id=viewIncident-0]',
                { hidden: true }
            );
            expect(viewIncidentButton).toBe(null);
            await init.saasLogout(page);
            await init.loginUser(user, page);
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await init.page$Eval(page, '#btnResolve_0', (e: $TSFixMe) => e.click());
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not show incident popup for resolved incidents',
        async () => {
            const projectName = 'Project1';

            await init.addIncident(monitorName, 'Degraded', page, 'Low');
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await init.page$Eval(page, 'button[id=viewIncident-0]', (e: $TSFixMe) => e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await init.page$Eval(page, '#btnResolve_0', (e: $TSFixMe) => e.click());
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: init.timeout,
            });
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            await init.saasLogout(page);
            await init.loginUser(user1, page);
            // Switch projects
            await init.switchProject(projectName, page);
            const viewIncidentButton = await init.page$(
                page,
                'button[id=viewIncident-0]',
                { hidden: true }
            );
            expect(viewIncidentButton).toBe(null);
            await init.saasLogout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show the incident created pop up to other team members',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            await init.addIncident(monitorName, 'Degraded', page, 'Low');
            await init.saasLogout(page);
            await init.loginUser(user1, page);
            // Switch projects
            await init.switchProject(projectName, page);
            const viewIncidentButton = await init.pageWaitForSelector(
                page,
                'button[id=viewIncident-0]',
                { visible: true, timeout: init.timeout }
            );
            expect(viewIncidentButton).toBeDefined();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to incident detail page when the view button is clicked',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await init.page$Eval(page, 'button[id=viewIncident-0]', (e: $TSFixMe) => e.click()
            );
            await init.pageWaitForSelector(page, '#cbIncident', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let pageTitle = await init.page$(page, '#cbIncident');
            pageTitle = await pageTitle.getProperty('innerText');
            pageTitle = await pageTitle.jsonValue();
            pageTitle.should.be.exactly('Incident');
            expect(pageTitle).toBeDefined();
            await init.saasLogout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should close incident popup',
        async () => {
            await init.addIncident(monitorName, 'Offline', page, 'Low');
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) => elem.click()
            );
            const closeButton = await init.pageWaitForSelector(
                page,
                '#closeIncident_0',
                {
                    hidden: true,
                }
            );
            expect(closeButton).toBeNull();
            await init.saasLogout(page);
            await init.loginUser(user1, page);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show closed incident to other team members',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            await init.switchProject(projectName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const viewIncidentButton = await init.page$(
                page,
                'button[id=viewIncident-0]'
            );
            expect(viewIncidentButton).toBeDefined();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show active incidents on the dashboard',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#closeIncident_0');
            await init.pageWaitForSelector(page, '#activeIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#activeIncidents');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '.activeIncidentList');
            const activeIncidents = await init.page$$Eval(
                page,
                '.activeIncidentList',
                (rows: $TSFixMe) => rows.length
            );

            expect(activeIncidents).toEqual(2);
            await init.saasLogout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );
    //The Active incident label has been refactored
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should display a modal when active incidents is clicked',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#activeIncidents');
            await init.page$Eval(page, '#activeIncidents', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incident_header_modal');
            let activeIncidents = await init.page$(
                page,
                '#incident_header_modal',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            activeIncidents = await activeIncidents.getProperty('innerText');
            activeIncidents = await activeIncidents.jsonValue();
            expect(activeIncidents).toEqual(
                'These incidents are currently active.'
            );
            await init.saasLogout(page);
            await init.loginUser(user, page);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should filter unacknowledged incidents',
        async () => {
            await init.addIncident(monitorName, 'Online', page, 'Low');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[id=viewIncident-0]');
            await init.page$Eval(page, 'button[id=viewIncident-0]', (elem: $TSFixMe) => elem.click()
            );

            // Acknowledge this incident
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#backToMonitorView');
            await init.page$Eval(page, '#backToMonitorView', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#filterToggle');
            await init.page$Eval(page, '#filterToggle', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#Unacknowledged');
            await init.page$Eval(page, '#Unacknowledged', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.createdIncidentListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const filteredIncidents = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
            const filteredIncidentsCount = filteredIncidents.length;

            expect(filteredIncidentsCount).toEqual(2);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should display a message if there are no incidents to display after filtering',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents');
            await init.page$Eval(page, '#incidents', (e: $TSFixMe) => e.click());

            // Acknowledge the second incident
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `tr#incident_1`);
            await init.page$Eval(page, `tr#incident_1`, (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents');
            await init.page$Eval(page, '#incidents', (e: $TSFixMe) => e.click());

            // Acknowledge the third incident
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `tr#incident_2`);
            await init.page$Eval(page, `tr#incident_2`, (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents');
            await init.page$Eval(page, '#incidents', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#filterToggle');
            await init.page$Eval(page, '#filterToggle', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#Unacknowledged');
            await init.page$Eval(page, '#Unacknowledged', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let filteredIncidents = await init.page$(
                page,
                'span#noIncidentsInnerText'
            );
            filteredIncidents = await filteredIncidents.getProperty(
                'innerText'
            );
            filteredIncidents = await filteredIncidents.jsonValue();

            expect(filteredIncidents).toEqual('No incidents to display');
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should filter unresolved incidents',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `button[id=view-resource-${monitorName}]`
            );
            await init.page$Eval(
                page,
                `button[id=view-resource-${monitorName}]`,
                (e: $TSFixMe) => e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#filterToggle');
            await init.page$Eval(page, '#filterToggle', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#Unresolved');
            await init.page$Eval(page, '#Unresolved', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.createdIncidentListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const filteredIncidents = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
            const filteredIncidentsCount = filteredIncidents.length;

            expect(filteredIncidentsCount).toEqual(3);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should clear filters',
        async () => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `button[id=view-resource-${monitorName}]`
            );
            await init.page$Eval(
                page,
                `button[id=view-resource-${monitorName}]`,
                (e: $TSFixMe) => e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#filterToggle');
            await init.page$Eval(page, '#filterToggle', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#clear');
            await init.page$Eval(page, '#clear', (e: $TSFixMe) => e.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.createdIncidentListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const filteredIncidents = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
            const filteredIncidentsCount = filteredIncidents.length;

            expect(filteredIncidentsCount).toEqual(5);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show incidents of different components on the incident logs menu',
        async () => {
            const componentName = 'NewComponent';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            await init.addAdditionalComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName2,
                page,
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 4.
                componentName
            );
            await init.addIncident(monitorName2, 'Offline', page, 'High');
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents');
            await init.page$Eval(page, '#incidents', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.createdIncidentListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const filteredIncidents = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
            const filteredIncidentsCount = filteredIncidents.length;
            expect(filteredIncidentsCount).toEqual(7);
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create an incident from the incident logs page and add it to the incident list',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents');
            await init.page$Eval(page, '#incidents', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#btnCreateIncident_${projectName}`
            );
            await init.page$Eval(page, `#btnCreateIncident_${projectName}`, (e: $TSFixMe) => e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#frmIncident');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#monitorDropdown');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#${monitorName2}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentType');
            await init.selectDropdownValue('#incidentTypeId', 'Degraded', page);
            await init.selectDropdownValue('#incidentPriority', 'Low', page);
            await init.page$Eval(page, '#createIncident', (e: $TSFixMe) => e.click());
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.createdIncidentListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const filteredIncidents = await init.page$$(
                page,
                'tr.createdIncidentListItem'
            );
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
    //             await init.page$Eval(page, '#closeIncident_0', elem => elem.click());
    //             await init.pageWaitForSelector(page, '#closeIncidentButton_0');
    //             await init.page$Eval(page, '#closeIncidentButton_0',e=>e.click());
    //             const elementHandle = await init.page$(page, '#modal-ok');
    //             expect(elementHandle).not.toBe(null);
    //         });
    //     },
    //     operationTimeOut
    // );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should close incident notification when an incident is viewed',
        async () => {
            const projectName = 'Project1';

            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // remove existing notification
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidents');
            await init.page$Eval(page, '#incidents', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#btnCreateIncident_${projectName}`
            );
            await init.page$Eval(page, `#btnCreateIncident_${projectName}`, (e: $TSFixMe) => e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#frmIncident');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#monitorDropdown');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#${monitorName2}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentType');
            await init.selectDropdownValue('#incidentTypeId', 'Online', page);
            await init.selectDropdownValue('#incidentPriority', 'Low', page);
            await init.page$Eval(page, '#createIncident', (e: $TSFixMe) => e.click());
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            await init.page$Eval(page, `#viewIncident-0`, (elem: $TSFixMe) => elem.click());
            await init.pageWaitForSelector(page, '#closeIncident_2', {
                hidden: true,
            });
            const rowsCount = (
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.page$$(page, '#notificationscroll button')
            ).length;

            expect(rowsCount).toEqual(2);
        },
        operationTimeOut
    );
});
