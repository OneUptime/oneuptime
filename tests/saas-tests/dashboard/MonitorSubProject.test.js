const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
const subProjectName = utils.generateRandomString();

describe('Monitor API With SubProjects', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        jest.retryTimes(3);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
            email,
            password,
        };

        await init.registerUser(user, page);

        // rename default project
        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page); // Growth Plan is needed for subproject

        // add sub-project
        await init.addSubProject(subProjectName, page);
        // Create component
        await init.addComponent(componentName, page, subProjectName);

        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // add new user to sub-project
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

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not display new monitor form for user that is not `admin` in sub-project.',
        async done => {
            const user = { email: newEmail, password: newPassword };
            // await init.loginUser(user, page);
            await init.logout(page);
            await init.registerAndLoggingTeamMember(user, page); // SubProject User registration and login

            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#components');
            const newComponentForm = await init.page$(page, '#form-new-component');
            expect(newComponentForm).toEqual(null);

            const newMonitorForm = await init.page$(page, '#form-new-monitor');
            expect(newMonitorForm).toEqual(null);
            await init.logout(page);
            // });

            done();
        },
        operationTimeOut
    );

    test(
        'should create a monitor in sub-project for valid `admin`',
        async done => {
            const user = { email: email, password };
            await init.loginUser(user, page);
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);
            // switch to invited project for new user
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
            let spanElement = await init.pageWaitForSelector(
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
        async done => {
            const monitorName = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);

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
            let spanElement = await init.pageWaitForSelector(
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
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#components');

            const projectBadgeSelector = await init.page$(page, `#badge_${projectName}`);

            expect(projectBadgeSelector).toEqual(null);

            await init.pageWaitForSelector(page, `#badge_${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });
            const subProjectBadgeSelector = await init.page$(page, 
                `#badge_${subProjectName}`
            );
            let textContent = await subProjectBadgeSelector.getProperty(
                'innerText'
            );

            textContent = await textContent.jsonValue();
            expect(textContent).toEqual(subProjectName.toUpperCase());

            done();
        },
        operationTimeOut
    );

    test(
        'should get both project and sub-project monitors for valid parent project user.',
        async done => {
            const monitorName = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);
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
            await init.pageWaitForSelector(page, `#badge_${subProjectName}`);
            const subProjectBadgeSelector = await init.page$(page, 
                `#badge_${subProjectName}`
            );

            let textContent = await subProjectBadgeSelector.getProperty(
                'innerText'
            );
            textContent = await textContent.jsonValue();
            expect(textContent.toUpperCase()).toEqual(
                subProjectName.toUpperCase()
            );

            done();
        },
        operationTimeOut
    );
});
