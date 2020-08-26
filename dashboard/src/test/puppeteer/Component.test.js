const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const newComponentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const newMonitorName = utils.generateRandomString();
const applicationLogName = utils.generateRandomString();

describe('Components', () => {
    const operationTimeOut = 100000;

    let cluster, browser, componentPage;

    beforeAll(async () => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });
        browser = await puppeteer.launch({
            ...utils.puppeteerLaunchConfig,
        });
        componentPage = await browser.newPage();

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
        await browser.idle();
        await browser.close();
    });

    test(
        'Should create new component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#components');
                await page.click('#components');

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', componentName);
                await page.click('button[type=submit]');
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                let spanElement;
                spanElement = await page.waitForSelector(
                    `span#component-title-${componentName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(componentName);
            });
        },
        operationTimeOut
    );

    test(
        'should show the correct path on the breadcrumbs inside a component',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                const moreBtn = `#more-details-${componentName}`;
                await page.waitForSelector(moreBtn, { visible: true });
                await page.click(moreBtn);

                const projectSelector = `#cbUnnamedProject`;
                const componentSelector = `#cb${componentName}`;
                await page.waitForSelector(projectSelector, { visible: true });
                const projectBreadcrumb = await page.evaluate(
                    projectSelector =>
                        document.querySelector(projectSelector).textContent,
                    projectSelector
                );
                await page.waitForSelector(componentSelector, {
                    visible: true,
                });
                const componentBreadcrumb = await page.evaluate(
                    componentSelector =>
                        document.querySelector(componentSelector).textContent,
                    componentSelector
                );

                expect(projectBreadcrumb).toBe('Unnamed Project');
                expect(componentBreadcrumb).toBe(componentName);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should not create new component when details are incorrect',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#components');
                await page.click('#components');

                // Fill and submit New Component form with incorrect details
                await page.waitForSelector('#form-new-component');
                await page.waitForSelector('#name');
                await page.click('button[type=submit]');

                let spanElement = await page.$(
                    '#form-new-component span#field-error'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'This field cannot be left blank'
                );
            });
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'should show the correct path on the breadcrumbs when viewing a particular monitor',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                const monitorDetailsBtn = `#more-details-${monitorName}`;
                await page.waitForSelector(monitorDetailsBtn, {
                    visible: true,
                });
                await page.click(monitorDetailsBtn);

                const projectSelector = `#cbUnnamedProject`;
                const componentSelector = `#cb${componentName}`;
                const monitorSelector = `#cb${monitorName}`;
                await page.waitForSelector(projectSelector, { visible: true });
                await page.waitForSelector(componentSelector, {
                    visible: true,
                });
                await page.waitForSelector(monitorSelector, { visible: true });

                const projectBreadcrumb = await page.evaluate(
                    projectSelector =>
                        document.querySelector(projectSelector).textContent,
                    projectSelector
                );
                const componentBreadcrumb = await page.evaluate(
                    componentSelector =>
                        document.querySelector(componentSelector).textContent,
                    componentSelector
                );
                const monitorBreadcrumb = await page.evaluate(
                    monitorSelector =>
                        document.querySelector(monitorSelector).textContent,
                    monitorSelector
                );
                expect(projectBreadcrumb).toBe('Unnamed Project');
                expect(componentBreadcrumb).toBe(componentName);
                expect(monitorBreadcrumb).toBe(monitorName);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a new application log in component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.click('#logs');

                // Fill and submit New Application  log form
                await page.waitForSelector('#form-new-application-log');
                await page.click('input[id=name]');
                await page.type('input[id=name]', applicationLogName);
                await page.click('button[type=submit]');
                //await page.goto(utils.DASHBOARD_URL);

                let spanElement;
                spanElement = await page.waitForSelector(
                    `span#application-log-title-${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(applicationLogName);
            });
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in a new component and get list of resources',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#components');
                await page.click('#components');

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', newComponentName);
                await page.click('button[type=submit]');

                await init.navigateToComponentDetails(newComponentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', newMonitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');
                await page.waitFor(5000);

                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components');
                await page.click('#components');
                await page.waitFor(5000);

                const newComponentSelector = '#component0 table > tbody > tr';
                await page.waitForSelector(newComponentSelector);

                const newResourceRows = await page.$$(newComponentSelector);
                const countNewResources = newResourceRows.length;

                expect(countNewResources).toEqual(1); // one monitor

                const componentSelector = '#component1 table > tbody > tr';
                await page.waitForSelector(componentSelector);

                const resourceRows = await page.$$(componentSelector);
                const countResources = resourceRows.length;

                expect(countResources).toEqual(2); // one application log and one monitor
            });
        },
        operationTimeOut
    );

    test(
        'Should create an incident in monitor details and change monitor status in component list',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // launch component page
                await init.loginUser(user, componentPage);
                await componentPage.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await componentPage.waitForSelector('#components');
                await componentPage.click('#components');
                let componentSpanElement = await componentPage.waitForSelector(
                    `#resource_type_${monitorName}`
                );
                componentSpanElement = await componentSpanElement.getProperty(
                    'innerText'
                );
                componentSpanElement = await componentSpanElement.jsonValue();

                expect(componentSpanElement).toMatch('Website Monitor');

                // use cluster to launch monitor page
                const monitorPage = page;
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    monitorPage
                );
                await monitorPage.bringToFront();
                await monitorPage.waitForSelector(
                    `#createIncident_${monitorName}`
                );
                await monitorPage.click(`#createIncident_${monitorName}`);
                await monitorPage.waitForSelector('#createIncident');
                await init.selectByText(
                    '#incidentType',
                    'Offline',
                    monitorPage
                );
                await monitorPage.type('#title', 'new incident');
                await monitorPage.click('#createIncident');
                await monitorPage.waitFor(2000);
                let monitorSpanElement = await monitorPage.waitForSelector(
                    `#monitor-status-${monitorName}`
                );
                monitorSpanElement = await monitorSpanElement.getProperty(
                    'innerText'
                );
                monitorSpanElement = await monitorSpanElement.jsonValue();
                // check that monitor status on monitor page is offline
                expect(monitorSpanElement).toMatch('Offline');
                await monitorPage.waitFor(2000);

                await componentPage.bringToFront();
                // check that the monitor is offline on component page
                componentSpanElement = await componentPage.waitForSelector(
                    `#resource_status_${monitorName}`
                );
                componentSpanElement = await componentSpanElement.getProperty(
                    'innerText'
                );
                componentSpanElement = await componentSpanElement.jsonValue();

                expect(componentSpanElement).toMatch('Offline');
                await componentPage.waitFor(2000);
                // bring monitor window to the front so as to resolve incident
                await monitorPage.bringToFront();
                // open incident details
                await monitorPage.waitForSelector(`#incident_${monitorName}_0`);
                await monitorPage.click(`#incident_${monitorName}_0`);

                // click resolve button
                // resolve incident
                await monitorPage.waitForSelector('#btnResolve_0');
                await monitorPage.click('#btnResolve_0');
                await monitorPage.waitForSelector('#ResolveText_0');
                // confirm it is resolved here
                const resolveTextSelector = await monitorPage.$(
                    '#ResolveText_0'
                );
                expect(resolveTextSelector).not.toBeNull();

                // goto component page
                await componentPage.bringToFront();
                // confirm that the monitor is back online!
                componentSpanElement = await componentPage.waitForSelector(
                    `#resource_status_${monitorName}`
                );
                componentSpanElement = await componentSpanElement.getProperty(
                    'innerText'
                );
                componentSpanElement = await componentSpanElement.jsonValue();

                expect(componentSpanElement).toMatch('Online');
            });
        },
        operationTimeOut
    );

    test(
        'Should get list of resources and confirm their types match',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#components');
                await page.click('#components');
                await page.waitFor(5000);

                const componentSelector = '#component1 table > tbody > tr';
                await page.waitForSelector(componentSelector);

                const resourceRows = await page.$$(componentSelector);
                const countResources = resourceRows.length;

                expect(countResources).toEqual(2); // one application log and one monitor

                let spanElement = await page.waitForSelector(
                    `#resource_type_${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                expect(spanElement).toMatch('Website Monitor');

                spanElement = await page.waitForSelector(
                    `#resource_type_${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                expect(spanElement).toMatch('Application Logs');

                spanElement = await page.waitForSelector(
                    `#resource_status_${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                expect(spanElement).toMatch('No Logs Yet');
            });
        },
        operationTimeOut
    );

    test(
        'Should get list of resources and  navigate to each page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#components');
                await page.click('#components');

                const componentSelector = '#component1 table > tbody > tr';
                await page.waitForSelector(componentSelector);

                const resourceRows = await page.$$(componentSelector);
                const countResources = resourceRows.length;

                expect(countResources).toEqual(2); // one application log and one monitor

                await page.click(`#view-resource-${applicationLogName}`);

                let spanElement = await page.waitForSelector(
                    `#application-log-title-${applicationLogName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                expect(spanElement).toMatch(applicationLogName);
            });
        },
        operationTimeOut
    );

    test(
        'Should edit a component',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Components page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle2',
                });
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                await page.waitForSelector(`#edit-component-${componentName}`);
                await page.click(`#edit-component-${componentName}`);
                await page.waitFor(2000);

                await page.waitForSelector('#componentName');
                await page.click('input[name=name]');
                await page.type('input[name=name]', '-two', { delay: 100 });
                await page.click('button[type=save]', { delay: 100 });

                let spanElement = await page.waitForSelector(
                    `span#component-title-${componentName}-two`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(`${componentName}-two`);
            });
        },
        operationTimeOut
    );

    test(
        'Should create new project from incident page and redirect to the component page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    newComponentName,
                    newMonitorName,
                    page
                );
                await page.waitForSelector(`#createIncident_${newMonitorName}`);
                await page.click(`#createIncident_${newMonitorName}`);
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.type('#title', 'new incident');
                await page.click('#createIncident');
                await page.waitFor(2000);
                await page.waitForSelector(
                    `table > tbody > tr#incident_${newMonitorName}_0`
                );
                await page.click(
                    `table > tbody > tr#incident_${newMonitorName}_0`
                );
                await page.waitFor(5000);
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#create-project');
                await page.click('#create-project');
                await page.waitForSelector('#name');
                await page.click('input[id=name]');
                await page.type('input[id=name]', utils.generateRandomString());
                await page.click('label[for=Startup_month]');
                await page.click('button[type=submit]');

                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                let currentPage = await page.waitForSelector('#cbComponents');
                currentPage = await currentPage.getProperty('innerText');
                currentPage = await currentPage.jsonValue();
                currentPage.should.be.exactly('Components');
            });
        },
        operationTimeOut
    );
});
