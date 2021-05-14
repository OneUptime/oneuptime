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

            await page.waitForSelector('#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#components');
            const newComponentForm = await page.$('#form-new-component');
            expect(newComponentForm).toEqual(null);

            const newMonitorForm = await page.$('#form-new-monitor');
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
            await page.waitForSelector('#monitors');
            await page.waitForSelector('#form-new-monitor');
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', subProjectMonitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await page.waitForSelector('#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.pageClick(page, 'button[type=submit]');
            let spanElement = await page.waitForSelector(
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

            await page.waitForSelector('#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, '[data-testId=type_manual]');
            await init.pageClick(page, 'button[type=submit]');
            let spanElement = await page.waitForSelector(
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
            await page.waitForSelector('#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#components');

            const projectBadgeSelector = await page.$(`#badge_${projectName}`);

            expect(projectBadgeSelector).toEqual(null);

            await page.waitForSelector(`#badge_${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });
            const subProjectBadgeSelector = await page.$(
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
            await page.waitForSelector('#form-new-monitor');
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, '[data-testId=type_manual]');
            await init.pageClick(page, '#addMonitorButton');
            await page.waitForSelector('.ball-beat', { hidden: true });
            await page.waitForSelector('#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#cbMonitors');
            await page.waitForSelector('#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await page.waitForSelector('input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', `${monitorName}1`);
            await init.pageClick(page, '[data-testId=type_manual]');
            await init.pageClick(page, '#addMonitorButton');
            await page.waitForSelector('.ball-beat', { hidden: true });
            await page.waitForSelector('#cbMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#cbMonitors');
            await page.waitForSelector(`#badge_${subProjectName}`);
            const subProjectBadgeSelector = await page.$(
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
