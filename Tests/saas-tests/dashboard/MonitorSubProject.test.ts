import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// Parent user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const projectName: string = utils.generateRandomString();
const subProjectMonitorName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();
// Sub-project user credentials
const newEmail: Email = utils.generateRandomBusinessEmail();
const newPassword: string = '1234567890';
const subProjectName: string = utils.generateRandomString();

describe('Monitor API With SubProjects', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user: $TSFixMe = {
            email,
            password,
        };

        await init.registerUser(user, page);

        // Rename default project
        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page); // Growth Plan is needed for subproject

        // Add sub-project
        await init.addSubProject(subProjectName, page);

        await init.pageClick(page, '#projectFilterToggle');

        await init.pageClick(page, `#project-${subProjectName}`);
        // Create component
        await init.addComponent(componentName, page);

        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // Add new user to sub-project

        await init.addUserToProject(
            {
                email: newEmail,
                role: 'Member',
                subProjectName,
            },
            page
        );

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not display new monitor form for user that is not `admin` in sub-project.',
        async (done: $TSFixMe) => {
            const user: $TSFixMe = { email: newEmail, password: newPassword };
            // Await init.loginUser(user, page);
            await init.saasLogout(page);
            await init.registerAndLoggingTeamMember(user, page); // SubProject User registration and login

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');
            const newComponentForm: $TSFixMe = await init.page$(
                page,
                '#form-new-component',
                { hidden: true }
            );
            expect(newComponentForm).toEqual(null);

            const newMonitorForm: $TSFixMe = await init.page$(
                page,
                '#form-new-monitor',
                {
                    hidden: true,
                }
            );
            expect(newMonitorForm).toEqual(null);
            await init.saasLogout(page);

            done();
        },
        operationTimeOut
    );

    test(
        'should create a monitor in sub-project for valid `admin`',
        async (done: $TSFixMe) => {
            const user: $TSFixMe = { email: email, password };
            await init.loginUser(user, page);
            // Navigate to details page of component created

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
            await init.navigateToComponentDetails(componentName, page);
            // Switch to invited project for new user

            await init.pageWaitForSelector(page, '#monitors');

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', subProjectMonitorName);

            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#url');

            await init.pageType(page, '#url', 'https://google.com');

            await init.pageClick(page, 'button[type=submit]');
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-title-${subProjectMonitorName}`,
                { visible: true, timeout: init.timeout }
            );

            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toBe(subProjectMonitorName);

            done();
        },
        operationTimeOut
    );

    test(
        'should create a monitor in parent project for valid `admin`',
        async (done: $TSFixMe) => {
            const monitorName: string = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // Navigate to details page of component created

            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#cbMonitors');

            await init.pageClick(page, '#newFormId');
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', monitorName);

            await init.pageClick(page, '[data-testId=type_manual]');

            await init.pageClick(page, 'button[type=submit]');
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: operationTimeOut }
            );

            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toBe(monitorName);

            done();
        },
        operationTimeOut
    );

    test(
        // eslint-disable-next-line quotes
        "should get only sub-project's monitors for valid sub-project user",
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');

            /* UI CHANGES */

            // This confirms that we have switched to the Subproject section

            let subProject: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#projectFilterToggle'
            );
            subProject = await subProject.getProperty('innerText');
            subProject = await subProject.jsonValue();
            expect(subProject).toEqual(subProjectName);

            let subProjectComponent: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#component-title-${componentName}`
            );
            subProjectComponent = await subProjectComponent.getProperty(
                'innerText'
            );
            subProjectComponent = await subProjectComponent.jsonValue();
            expect(subProjectComponent).toEqual(componentName);

            done();
        },
        operationTimeOut
    );

    test(
        'should get both project and sub-project monitors for valid parent project user.',
        async (done: $TSFixMe) => {
            const monitorName: string = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#cbMonitors');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', monitorName);

            await init.pageClick(page, '[data-testId=type_manual]');

            await init.pageClick(page, '#addMonitorButton');
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            await init.pageWaitForSelector(page, '#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#cbMonitors');

            await init.pageClick(page, '#newFormId');
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', `${monitorName}1`);

            await init.pageClick(page, '[data-testId=type_manual]');

            await init.pageClick(page, '#addMonitorButton');
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            await init.pageWaitForSelector(page, '#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#cbMonitors');
            /* UI CHANGES: Badge has been removed! */

            const additionalMonitor1: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );

            expect(additionalMonitor1).toBeDefined();

            const additionalMonitor2: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}1`
            );
            expect(additionalMonitor2).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
