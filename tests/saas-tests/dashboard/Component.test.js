const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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
let browser, browser2, page, monitorPage;
describe('Components', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser2 = await puppeteer.launch(utils.puppeteerLaunchConfig);
        browser = await puppeteer.launch({
            ...utils.puppeteerLaunchConfig,
        });
        monitorPage = await browser2.newPage();
        page = await browser.newPage();

        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
    });

    afterAll(async done => {
        await browser.close();
        await browser2.close();
        done();
    });

    test(
        'Should create new component',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());
            // Fill and submit New Component form
            await init.pageWaitForSelector(page, '#form-new-component');
            await init.pageType(page, 'input[id=name]', componentName);
            await init.page$Eval(page, 'button[type=submit]', e => e.click());
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', e => e.click());

            let spanElement;
            spanElement = await init.pageWaitForSelector(
                page,
                `span#component-title-${componentName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(componentName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in component and confirm that monitor quick tip shows',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            const customTutorialType = 'monitor';
            // find monitor quick tip and confirm it shows
            const monitorQuickTip = await init.pageWaitForSelector(
                page,
                `#quick-tip-${customTutorialType}`
            );
            expect(monitorQuickTip).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in component and goto the details page after creating',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            const newMonitorName = `another-${monitorName}`;
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]');
            await init.pageType(page, 'input[id=name]', newMonitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${newMonitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(newMonitorName);

            // check if the tabs on the details page are defined
            const monitorTabsComponent = await init.pageWaitForSelector(
                page,
                `#customTabList`
            );
            expect(monitorTabsComponent).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should show the correct path on the breadcrumbs when viewing a particular monitor',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            const monitorDetailsBtn = `#more-details-${monitorName}`;
            await init.pageWaitForSelector(page, monitorDetailsBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, monitorDetailsBtn, e => e.click());

            const projectSelector = `#cbUnnamedProject`;
            const componentSelector = `#cb${componentName}`;
            const monitorSelector = `#cb${monitorName}`;
            await init.pageWaitForSelector(page, projectSelector, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, componentSelector, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, monitorSelector, {
                visible: true,
                timeout: init.timeout,
            });

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

            done();
        },
        operationTimeOut
    );

    test(
        'Should create a new log container in component',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#logs');
            await init.pageClick(page, '#logs');

            // Fill and submit New Application  log form
            await init.pageWaitForSelector(page, '#form-new-application-log');
            await init.pageType(page, 'input[id=name]', applicationLogName);
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

            let spanElement;
            spanElement = await init.pageWaitForSelector(
                page,
                `span#application-log-title-${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(applicationLogName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a new monitor in a new component and get list of resources',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());

            // Fill and submit New Component form
            await init.pageWaitForSelector(page, '#form-new-component');
            await init.pageType(page, 'input[id=name]', newComponentName);
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]');
            await init.pageType(page, 'input[id=name]', newMonitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', e => e.click());
            await init.pageWaitForSelector(page, `#cb${newMonitorName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            const newComponentSelector = `#count_${newComponentName}`;
            const componentSelector = `#count_${componentName}`;

            await init.pageWaitForSelector(page, newComponentSelector);
            const newResourceCount = await init.page$Eval(
                page,
                newComponentSelector,
                elem => elem.textContent
            );
            expect(newResourceCount).toEqual('1 Resource');

            await init.pageWaitForSelector(page, componentSelector);
            const firstResourceCount = await init.page$Eval(
                page,
                componentSelector,
                elem => elem.textContent
            );
            expect(firstResourceCount).toEqual('3 Resources');
            done();
        },
        operationTimeOut
    );

    test(
        'Should create an incident in monitor details and change monitor status in component list',
        async done => {
            // launch component page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());
            let componentSpanElement = await init.pageWaitForSelector(
                page,
                `#resource_type_${monitorName}`
            );
            componentSpanElement = await componentSpanElement.getProperty(
                'innerText'
            );
            componentSpanElement = await componentSpanElement.jsonValue();

            expect(componentSpanElement).toMatch('Website Monitor');

            await monitorPage.bringToFront();

            await init.loginUser(user, monitorPage);
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                monitorPage
            );

            await monitorPage.waitForSelector(
                `#monitorCreateIncident_${monitorName}`
            );
            await monitorPage.$eval(
                `#monitorCreateIncident_${monitorName}`,
                e => e.click()
            );
            await monitorPage.waitForSelector('#createIncident');
            await init.selectDropdownValue(
                '#incidentType',
                'Offline',
                monitorPage
            );
            await init.selectDropdownValue(
                '#incidentPriority',
                'Low',
                monitorPage
            );
            await init.pageClick(monitorPage, '#createIncident');
            await monitorPage.waitForSelector('#createIncident', {
                hidden: true,
            });

            // close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', elem =>
                elem.click()
            );

            await page.bringToFront();
            // check that the monitor is offline on component page
            componentSpanElement = await init.pageWaitForSelector(
                page,
                `#resource_status_${monitorName}`
            );
            componentSpanElement = await componentSpanElement.getProperty(
                'innerText'
            );
            componentSpanElement = await componentSpanElement.jsonValue();

            expect(componentSpanElement).toMatch('Offline');
            // bring monitor window to the front so as to resolve incident
            await monitorPage.bringToFront();
            // open incident details
            await monitorPage.waitForSelector(`#incident_${monitorName}_0`);
            await monitorPage.$eval(`#incident_${monitorName}_0`, e =>
                e.click()
            );

            // click acknowledge button
            // acknowledge incident
            await monitorPage.waitForSelector('#btnAcknowledge_0');
            await monitorPage.$eval('#btnAcknowledge_0', e => e.click());
            await monitorPage.waitForSelector('#btnAcknowledge_0');

            // click resolve button
            // resolve incident
            await monitorPage.waitForSelector('#btnResolve_0');
            await monitorPage.$eval('#btnResolve_0', e => e.click());
            await monitorPage.waitForSelector('#ResolveText_0');
            // confirm it is resolved here
            const resolveTextSelector = await monitorPage.$('#ResolveText_0');
            expect(resolveTextSelector).not.toBeNull();

            // goto component page
            await page.bringToFront();
            await page.reload({ waitUntil: 'networkidle0' });
            // confirm that the monitor is back online!
            componentSpanElement = await init.pageWaitForSelector(
                page,
                `#resource_status_${monitorName}`
            );
            componentSpanElement = await componentSpanElement.getProperty(
                'innerText'
            );
            componentSpanElement = await componentSpanElement.jsonValue();

            expect(componentSpanElement).toMatch('Online');

            done();
        },
        operationTimeOut
    );

    test(
        'Should get list of resources and confirm their types match',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#count_${componentName}`);
            const firstResourceCount = await init.page$Eval(
                page,
                `#count_${componentName}`,
                elem => elem.textContent
            );
            expect(firstResourceCount).toEqual('3 Resources');

            let spanElement = await init.pageWaitForSelector(
                page,
                `#resource_type_${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toMatch('Website Monitor');

            spanElement = await init.pageWaitForSelector(
                page,
                `#resource_type_${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toMatch('Log Container');

            spanElement = await init.pageWaitForSelector(
                page,
                `#resource_status_${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toMatch('No Logs Yet');
            done();
        },
        operationTimeOut
    );

    test(
        'Should get list of resources and  navigate to each page',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#count_${componentName}`);
            const firstResourceCount = await init.page$Eval(
                page,
                `#count_${componentName}`,
                elem => elem.textContent
            );
            expect(firstResourceCount).toEqual('3 Resources'); // one log container and two monitor

            await init.page$Eval(
                page,
                `#view-resource-${applicationLogName}`,
                e => e.click()
            );

            let spanElement = await init.pageWaitForSelector(
                page,
                `#application-log-title-${applicationLogName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            expect(spanElement).toMatch(applicationLogName);
            done();
        },
        operationTimeOut
    );

    test('should edit a component in the component settings SideNav', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });

        await init.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: init.timeout,
        });
        await init.page$Eval(page, '#components', e => e.click());

        await init.pageClick(page, `#more-details-${componentName}`);

        await init.pageWaitForSelector(page, '#componentSettings');
        await init.pageClick(page, '#componentSettings');

        await init.pageWaitForSelector(page, 'input[name=name]');
        await init.pageType(page, 'input[name=name]', '-two');
        await init.page$Eval(page, '#editComponentButton', e => e.click());

        let spanElement = await init.pageWaitForSelector(
            page,
            `span#component-title-${componentName}-two`
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(`${componentName}-two`);
        done();
    });

    test('should delete a component in the component settings sideNav', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });

        await init.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: init.timeout,
        });
        await init.pageClick(page, '#components');

        await init.pageClick(page, `#more-details-${componentName}-two`);

        await init.pageWaitForSelector(page, '#componentSettings');
        await init.pageClick(page, '#componentSettings');

        await init.pageWaitForSelector(page, '#advanced');
        await init.pageClick(page, '#advanced');

        await init.pageWaitForSelector(
            page,
            `#delete-component-${componentName}-two`,
            {
                visible: true,
            }
        );
        await init.pageClick(page, `#delete-component-${componentName}-two`);

        await init.pageWaitForSelector(page, '#deleteComponent', {
            visible: true,
            timeout: init.timeout,
        });
        await init.pageClick(page, '#deleteComponent'); // after deleting the component

        const componentClicked = await init.pageWaitForSelector(
            page,
            '#components',
            {
                visible: true,
            }
        );
        expect(componentClicked).toBeDefined();
        done();
    });

    test(
        'Should create new project from incident page and redirect to the home page and not component page',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                newComponentName,
                newMonitorName,
                page
            );
            await init.pageWaitForSelector(
                page,
                `#monitorCreateIncident_${newMonitorName}`
            );
            await init.page$Eval(
                page,
                `#monitorCreateIncident_${newMonitorName}`,
                e => e.click()
            );
            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            await init.selectDropdownValue('#incidentPriority', 'Low', page);
            await init.page$Eval(page, '#createIncident', e => e.click());
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            // close incident modal
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', elem =>
                elem.click()
            );

            await init.pageWaitForSelector(
                page,
                `#incident_${newMonitorName}_0`
            );
            await init.page$Eval(page, `#incident_${newMonitorName}_0`, e =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#AccountSwitcherId');
            await init.page$Eval(page, '#AccountSwitcherId', e => e.click());
            await init.pageWaitForSelector(page, '#create-project');
            await init.page$Eval(page, '#create-project', e => e.click());
            await init.pageWaitForSelector(page, '#name');
            await init.pageType(
                page,
                'input[id=name]',
                utils.generateRandomString()
            );
            await init.page$Eval(page, 'label[for=Startup_month]', e =>
                e.click()
            );
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

            let currentPage = await init.pageWaitForSelector(page, '#cbHome', {
                visible: true,
                timeout: init.timeout,
            });
            currentPage = await currentPage.getProperty('innerText');
            currentPage = await currentPage.jsonValue();
            currentPage.should.be.exactly('Home');
            done();
        },
        operationTimeOut
    );

    test(
        'Should create component and display component resource status',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // Navigate to Components page
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());

            // Fill and submit New Component form
            await init.pageWaitForSelector(page, '#form-new-component');
            await init.pageType(page, 'input[id=name]', newComponentName);
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]');
            await init.pageType(page, 'input[id=name]', newMonitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', e => e.click());
            await init.pageWaitForSelector(page, `#cb${newMonitorName}`, {
                visible: true,
                timeout: init.timeout,
            });
            //create offline incidence
            await init.page$Eval(
                page,
                `#monitorCreateIncident_${newMonitorName}`,
                e => e.click()
            );

            await init.page$Eval(page, `#createIncident`, e => e.click());
            await init.pageWaitForSelector(page, '#viewIncident-0');

            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', e => e.click());

            // Check for resource status Id
            await init.pageWaitForSelector(
                page,
                `#resource_status_${newMonitorName}`
            );
            let element = await page.$(`#resource_status_${newMonitorName}`);
            let value = await page.evaluate(el => el.textContent, element);

            expect(value.trim()).toEqual('offline');
            done();
        },
        operationTimeOut
    );
});
