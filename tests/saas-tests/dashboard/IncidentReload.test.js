import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Monitor Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        await init.addIncident(monitorName, 'Offline', page);
        await init.pageClick(page, '#closeIncident_0');
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the monitor in component-details page and confirm no error',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#incidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#incidentLog');
            await init.pageWaitForSelector(page, '#cbIncidents');
            await init.pageWaitForSelector(page, `#incident_title_0`);
            //To confirm no error on page reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                `#incident_title_0`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to incident detail page and reload to check errors',
        async done => {
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#incidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#incidentLog');
            await init.pageWaitForSelector(page, `#incident_title_0`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClickNavigate(page, `#incident_title_0`);

            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });
            //To confirm no error on page reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncidentLog', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#incident_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to incident page, click on the incident and reload to check errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#incidents', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#incidents');
            await init.pageWaitForSelector(page, `#incident_title_0`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClickNavigate(page, `#incident_title_0`);
            await init.pageWaitForSelector(page, '#incident_0', {
                visible: true,
                timeout: init.timeout,
            });
            //To confirm no error on page reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbIncident', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#incident_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
