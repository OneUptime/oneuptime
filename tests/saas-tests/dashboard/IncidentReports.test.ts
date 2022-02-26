// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'
let browser: $TSFixMe, page: $TSFixMe;

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incident Reports API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(600000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        // user
        await init.registerUser(user, page);

        // Create component
        await init.addComponent(componentName, page);

        // add new monitor to project
        await init.pageWaitForSelector(page, '#form-new-monitor', {
            visible: true,
            timeout: init.timeout,
        });
        await init.page$Eval(page, 'input[id=name]', (e: $TSFixMe) => e.click());
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '[data-testId=type_url]');
        await init.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: init.timeout,
        });
        await init.page$Eval(page, '#url', (e: $TSFixMe) => e.click());
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
        await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) => e.click());
        await init.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should display why degraded incident was created', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('statusCode').value = '')
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#responseTime');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=responseTime]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=responseTime]', '5000');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#statusCode');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=statusCode]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=statusCode]', '200');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'button[type=submit]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#save-btn');
        await init.pageWaitForSelector(page, '#save-btn', {
            visible: true,
            timeout: init.timeout,
        });

        await page.goto(utils.DASHBOARD_URL, { waitUntil: 'networkidle2' }); // Incident Status is present on Dashboard and Incident Detail Page
        await init.pageWaitForSelector(page, '#closeIncident_0', {
            visible: true,
            timeout: 600000,
        });
        let incidentReportElement = await init.pageWaitForSelector(
            page,
            `#${monitorName}_IncidentReport_0`,
            { visible: true, timeout: operationTimeOut }
        );
        incidentReportElement = await incidentReportElement.getProperty(
            'innerText'
        );
        incidentReportElement = await incidentReportElement.jsonValue();
        expect(
            incidentReportElement.startsWith('Response Time is') // 'was' has been changed to 'is'
        ).toEqual(true);
    }, 600000);

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should display why offline incident was created', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            () => (document.getElementById('statusCode').value = '')
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#responseTime');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=responseTime]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=responseTime]', '0');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#statusCode');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[name=statusCode]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[name=statusCode]', '400');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'button[type=submit]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#save-btn');
        await init.pageWaitForSelector(page, '#save-btn', {
            visible: true,
            timeout: init.timeout,
        });

        // Navigate to Component details
        await page.goto(utils.DASHBOARD_URL, { waitUntil: 'networkidle2' });
        await init.pageWaitForSelector(page, '#closeIncident_1', {
            visible: true,
            timeout: 600000,
        });
        let incidentReportElement = await init.pageWaitForSelector(
            page,
            `#${monitorName}_IncidentReport_0`,
            { visible: true, timeout: operationTimeOut }
        );
        incidentReportElement = await incidentReportElement.getProperty(
            'innerText'
        );
        incidentReportElement = await incidentReportElement.jsonValue();
        expect(incidentReportElement).toMatch(/Status Code is 400./); // 'was' has been changed to 'is'. 'Response Time is' has been added to rendered page
    }, 600000);
});
