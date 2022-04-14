import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const newComponentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const newMonitorName = utils.generateRandomString();
let browser: $TSFixMe,
    browser2: $TSFixMe,
    page: $TSFixMe,
    monitorPage: $TSFixMe;

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
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        await browser2.close();
        done();
    });

    test(
        'Should create an incident in monitor details and change monitor status in component list',
        async (done: $TSFixMe) => {
            // launch component page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

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
                (e: $TSFixMe) => e.click()
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
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) =>
                elem.click()
            );

            await page.bringToFront();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );
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
            await monitorPage.waitForSelector(`#incident_0`);
            await monitorPage.$eval(`#incident_0`, (e: $TSFixMe) => e.click());

            // click acknowledge button
            // acknowledge incident
            await monitorPage.waitForSelector('#btnAcknowledge_0');
            await monitorPage.$eval('#btnAcknowledge_0', (e: $TSFixMe) =>
                e.click()
            );
            await monitorPage.waitForSelector('#AcknowledgeText_0');

            // click resolve button
            // resolve incident
            await monitorPage.waitForSelector('#btnResolve_0');
            await monitorPage.$eval('#btnResolve_0', (e: $TSFixMe) =>
                e.click()
            );
            await monitorPage.waitForSelector('#ResolveText_0');
            // confirm it is resolved here
            const resolveTextSelector = await monitorPage.$('#ResolveText_0');
            expect(resolveTextSelector).not.toBeNull();

            // goto component page
            await page.bringToFront();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );
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
        'should edit a component in the component settings SideNav',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageClick(page, `#more-details-${componentName}`);

            await init.pageWaitForSelector(page, '#componentSettings');

            await init.pageClick(page, '#componentSettings');

            await init.pageWaitForSelector(page, 'input[name=name]');

            await init.pageType(page, 'input[name=name]', '-two');
            await init.page$Eval(page, '#editComponentButton', (e: $TSFixMe) =>
                e.click()
            );

            let spanElement = await init.pageWaitForSelector(
                page,
                `span#component-title-${componentName}-two`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(`${componentName}-two`);
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a component in the component settings sideNav',
        async (done: $TSFixMe) => {
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

            await init.pageClick(
                page,
                `#delete-component-${componentName}-two`
            );

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
        },
        operationTimeOut
    );

    test(
        'Should create new project from incident page and redirect to the home page and not component page',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.addMonitorToComponent(
                componentName,
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
                (e: $TSFixMe) => e.click()
            );

            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            await init.selectDropdownValue('#incidentPriority', 'Low', page);
            await init.page$Eval(page, '#createIncident', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
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
                `#incident_${newMonitorName}_0`
            );
            await init.page$Eval(
                page,
                `#incident_${newMonitorName}_0`,
                (e: $TSFixMe) => e.click()
            );

            await init.pageWaitForSelector(page, '#AccountSwitcherId');
            await init.page$Eval(page, '#AccountSwitcherId', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#create-project');
            await init.page$Eval(page, '#create-project', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#name');

            await init.pageType(
                page,
                'input[id=name]',
                utils.generateRandomString()
            );
            await init.page$Eval(
                page,
                'label[for=Startup_month]',
                (e: $TSFixMe) => e.click()
            );
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );

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
        'Should create component, incident and display correct component resource status',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // Navigate to Components page

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            // Fill and submit New Component form

            await init.pageWaitForSelector(page, '#form-new-component');

            await init.pageType(page, 'input[id=name]', newComponentName);
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );

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
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, `#cb${newMonitorName}`, {
                visible: true,
                timeout: init.timeout,
            });
            //create offline incidence
            await init.page$Eval(
                page,
                `#monitorCreateIncident_${newMonitorName}`,
                (e: $TSFixMe) => e.click()
            );

            await init.page$Eval(page, `#createIncident`, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#viewIncident-0');

            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            // Check for resource status Id

            await init.pageWaitForSelector(
                page,
                `#resource_status_${newMonitorName}`
            );
            const element = await page.$(`#resource_status_${newMonitorName}`);
            const value = await page.evaluate(
                (el: $TSFixMe) => el.textContent,
                element
            );

            expect(value.trim()).toEqual('offline');
            done();
        },
        operationTimeOut
    );
});
