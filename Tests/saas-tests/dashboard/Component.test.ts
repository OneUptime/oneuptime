import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

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
let browser: $TSFixMe, page: $TSFixMe;

describe('Components', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch({
            ...utils.puppeteerLaunchConfig,
        });
        page = await browser.newPage();

        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should create new component',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );
            // Fill and submit New Component form

            await init.pageWaitForSelector(page, '#form-new-component');

            await init.pageType(page, 'input[id=name]', componentName);
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

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
        async (done: $TSFixMe) => {
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
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );

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
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            const newMonitorName = `another-${monitorName}`;

            await init.pageWaitForSelector(page, '#cbMonitors');

            await init.pageClick(page, '#newFormId');

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
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);
            const monitorDetailsBtn = `#more-details-${monitorName}`;
            await init.pageWaitForSelector(page, monitorDetailsBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, monitorDetailsBtn, (e: $TSFixMe) =>
                e.click()
            );

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
                (projectSelector: $TSFixMe) =>
                    document.querySelector(projectSelector).textContent,
                projectSelector
            );
            const componentBreadcrumb = await page.evaluate(
                (componentSelector: $TSFixMe) =>
                    document.querySelector(componentSelector).textContent,
                componentSelector
            );
            const monitorBreadcrumb = await page.evaluate(
                (monitorSelector: $TSFixMe) =>
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
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            // Fill and submit New Application  log form

            await init.pageWaitForSelector(page, '#form-new-application-log');

            await init.pageType(page, 'input[id=name]', applicationLogName);
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );

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
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            // Fill and submit New Component form

            await init.pageWaitForSelector(page, '#cbComponents');

            await init.pageClick(page, '#newFormId');

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

            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

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
                (elem: $TSFixMe) => elem.textContent
            );
            expect(newResourceCount).toEqual('1 Resource');

            await init.pageWaitForSelector(page, componentSelector);
            const firstResourceCount = await init.page$Eval(
                page,
                componentSelector,
                (elem: $TSFixMe) => elem.textContent
            );
            expect(firstResourceCount).toEqual('3 Resources');
            done();
        },
        operationTimeOut
    );

    test(
        'Should get list of resources and confirm their types match',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#count_${componentName}`);
            const firstResourceCount = await init.page$Eval(
                page,
                `#count_${componentName}`,
                (elem: $TSFixMe) => elem.textContent
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
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#count_${componentName}`);
            const firstResourceCount = await init.page$Eval(
                page,
                `#count_${componentName}`,
                (elem: $TSFixMe) => elem.textContent
            );
            expect(firstResourceCount).toEqual('3 Resources'); // one log container and two monitor

            await init.page$Eval(
                page,
                `#view-resource-${applicationLogName}`,
                (e: $TSFixMe) => e.click()
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
});
