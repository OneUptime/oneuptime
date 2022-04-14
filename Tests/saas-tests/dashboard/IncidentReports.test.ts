import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;

// parent user credentials
const email: $TSFixMe: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const monitorName: $TSFixMe: string = utils.generateRandomString();
const componentName: $TSFixMe: string = utils.generateRandomString();

describe('Incident Reports API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(600000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
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
        await init.page$Eval(page, 'input[id=name]', (e: $TSFixMe) =>
            e.click()
        );

        await init.pageType(page, 'input[id=name]', monitorName);

        await init.pageClick(page, '[data-testId=type_url]');
        await init.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: init.timeout,
        });
        await init.page$Eval(page, '#url', (e: $TSFixMe) => e.click());

        await init.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
        await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
            e.click()
        );
        await init.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test('should display why degraded incident was created', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );

        await init.pageWaitForSelector(page, '#responseTime');

        await init.pageClick(page, 'input[name=responseTime]');

        await init.pageType(page, 'input[name=responseTime]', '5000');

        await init.pageWaitForSelector(page, '#statusCode');

        await init.pageClick(page, 'input[name=statusCode]');

        await init.pageType(page, 'input[name=statusCode]', '200');

        await init.pageClick(page, 'button[type=submit]');

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
        let incidentReportElement: $TSFixMe = await init.pageWaitForSelector(
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

    test('should display why offline incident was created', async () => {
        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );

        await init.pageWaitForSelector(page, '#responseTime');

        await init.pageClick(page, 'input[name=responseTime]');

        await init.pageType(page, 'input[name=responseTime]', '0');

        await init.pageWaitForSelector(page, '#statusCode');

        await init.pageClick(page, 'input[name=statusCode]');

        await init.pageType(page, 'input[name=statusCode]', '400');

        await init.pageClick(page, 'button[type=submit]');

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
        let incidentReportElement: $TSFixMe = await init.pageWaitForSelector(
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
