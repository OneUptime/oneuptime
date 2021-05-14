const utils = require('../../test-utils');
const puppeteer = require('puppeteer');
const init = require('../../test-init');

let page, browser;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const projectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();

describe('Check status-page up', () => {
    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should load status page and show status page is not present',
        async done => {
            await page.goto(`${utils.STATUSPAGE_URL}/fakeStatusPageId`, {
                waitUntil: 'domcontentloaded',
            });
            await page.waitForSelector('#app-loading', { visible: true, timeout: init.timeout });
            const response = await page.$eval('#app-loading > div', e => {
                return e.innerHTML;
            });
            expect(response).toBe('Page Not Found');
            done();
        },
        init.timeout
    );

    test(
        'should create a status-page',
        async done => {
            await init.registerUser(user, page);
            await init.renameProject(projectName, page);

            // Create a Status-Page with a Manual Monitor and Display the Monitor in Status-Page Url
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#statusPages', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`, {
                visible: true,
            });
            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#name', { visible: true, timeout: init.timeout });
            await page.waitForSelector('input[id=name]', { visible: true, timeout: init.timeout });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', statusPageName);
            await init.pageClick(page, '#btnCreateStatusPage');
            await page.waitForSelector('#statusPagesListContainer', {
                visible: true,
            });
            await page.waitForSelector('#viewStatusPage', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector(`#header-${statusPageName}`, {
                visible: true,
            });

            // To confirm the status-page name.
            let spanElement = await page.waitForSelector(
                `#header-${statusPageName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(statusPageName);

            done();
        },
        init.timeout
    );

    test(
        'should create a manual monitor',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await page.$eval('#components', el => el.click());
            // Fill and submit New Component form
            await init.addComponent(componentName, page);
            // Create a Manual Monitor
            const description = 'My Manual Monitor';
            await init.addMonitor(monitorName, description, page);
            // To confirm the manual monitor is created.
            let spanElement = await page.waitForSelector(
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        init.timeout
    );

    test(
        'should add monitor to status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#statusPages', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer', {
                visible: true,
            });
            await page.waitForSelector('#viewStatusPage', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector('#addMoreMonitors', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#addMoreMonitors');
            await init.selectByText(
                '#monitor-name',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#monitor-description');
            await init.pageType(
                page,
                '#monitor-description',
                'Status Page Description'
            );
            await init.pageClick(page, '#manual-monitor-checkbox');
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            // CLick status Page Url
            await init.clickStatusPageUrl(page);

            // To confirm the monitor is present in the status-page
            let spanElement = await page.waitForSelector(
                `#monitor-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        init.timeout
    );

    test(
        'Should confirm status-page monitor values does not change on theme change',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#statusPages', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer', {
                visible: true,
            });
            await page.waitForSelector('#viewStatusPage', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#viewStatusPage');
            await init.themeNavigationAndConfirmation(page, 'Classic');
            let spanElement;
            spanElement = await page.waitForSelector('#monitor-name', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(`${componentName} / ${monitorName}`);

            // Changing it back to Clean theme as this is the team that other tests depend on.
            await init.themeNavigationAndConfirmation(page, 'Clean');
            spanElement = await page.waitForSelector('#monitor-name', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(`${componentName} / ${monitorName}`); // Another Confirmation
            done();
        },
        init.timeout
    );

    test(
        'should add more monitors and see if they are present on the status-page',
        async done => {
            // This creates 2 additonal monitors
            for (let i = 0; i < 2; i++) {
                await init.navigateToComponentDetails(componentName, page);
                const monitorName = utils.generateRandomString();
                const description = utils.generateRandomString();
                await init.addMonitor(monitorName, description, page);
                await page.waitForSelector(`#monitor-title-${monitorName}`, {
                    visible: true,
                });

                await init.addMonitorToStatusPage(
                    componentName,
                    monitorName,
                    page
                );
            }
            // To confirm the monitors on status-page
            await init.clickStatusPageUrl(page);

            await page.waitForSelector('.monitor-list', { visible: true, timeout: init.timeout });
            const monitor = await page.$$('.monitor-list');
            const monitorLength = monitor.length;
            expect(monitorLength).toEqual(3);

            done();
        },
        init.timeout
    );

    test(
        'should create an offline incident and view it on status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            await page.waitForSelector(
                `#monitorCreateIncident_${monitorName}`,
                {
                    visible: true,
                }
            );
            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            await page.waitForSelector('#incidentTitleLabel', {
                visible: true,
            });
            await init.pageClick(page, '#createIncident');

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#viewIncident-0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#closeIncident_0');
            await page.waitForSelector('#closeIncident_0', { hidden: true });

            await init.navigateToStatusPage(page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            let spanElement = await page.waitForSelector('#status-note', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch('Some resources are offline');

            done();
        },
        init.timeout
    );

    test(
        'should resolve offline incident and view status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#btnAcknowledge_0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#btnAcknowledge_0');
            await page.waitForSelector('#btnResolve_0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#btnResolve_0');

            await page.reload({
                waitUntil: 'networkidle2',
            });
            await init.navigateToStatusPage(page);
            let spanElement = await page.waitForSelector('#status-note', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch('All resources are operational');
            done();
        },
        init.timeout
    );

    test(
        'should create an degraded incident and view it on status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            await page.waitForSelector(
                `#monitorCreateIncident_${monitorName}`,
                {
                    visible: true,
                }
            );
            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            await page.waitForSelector('#incidentTitleLabel', {
                visible: true,
            });
            await init.selectByText('#incidentType', 'Degraded', page);
            await init.pageClick(page, '#createIncident');

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#viewIncident-0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#closeIncident_0');
            await page.waitForSelector('#closeIncident_0', { hidden: true });

            await init.navigateToStatusPage(page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            let spanElement = await page.waitForSelector('#status-note', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch('Some resources are degraded');

            done();
        },
        init.timeout
    );

    test(
        'should resolve degraded incident and view status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#btnAcknowledge_0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#btnAcknowledge_0');
            await page.waitForSelector('#btnResolve_0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#btnResolve_0');

            await page.reload({
                waitUntil: 'networkidle2',
            });
            await init.navigateToStatusPage(page);
            let spanElement = await page.waitForSelector('#status-note', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch('All resources are operational');
            done();
        },
        init.timeout
    );

    test(
        'should create an offline incident and confirm the description note on status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            const note = utils.generateRandomString();
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            await page.waitForSelector(
                `#monitorCreateIncident_${monitorName}`,
                {
                    visible: true,
                }
            );
            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            await page.waitForSelector('#incidentTitleLabel', {
                visible: true,
            });
            await init.pageClick(page, '#description', { clickCount: 3 });
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await init.pageType(page, '#description', note);
            await init.pageClick(page, '#createIncident');

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#viewIncident-0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#closeIncident_0');
            await page.waitForSelector('#closeIncident_0', { hidden: true });

            await init.navigateToStatusPage(page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            let spanElement = await page.waitForSelector('#note', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(note);
            done();
        },
        init.timeout
    );
});
