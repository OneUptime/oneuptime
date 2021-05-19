const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');
let browser, page;

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('Incident Reports API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(360000);

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
        await init.addNewMonitorToComponent(page, componentName, monitorName);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should display why offline incident was created',
        async () => {
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
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#closeIncident_1', {
                visible: true,
                timeout: 100000,
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
        },
        operationTimeOut
    );
});
