const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');


// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('Incident Reports API', () => {
    const operationTimeOut = init.timeout;

    

    beforeAll(async () => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: init.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            // user
            await init.registerUser(user, page);

            // Create component
            await init.addComponent(componentName, page);

            // add new monitor to project
            await page.waitForSelector('#form-new-monitor', { visible: true });
            await page.$eval('input[id=name]', e => e.click());
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await page.$eval('#url', e => e.click());
            await init.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
            await page.$eval('button[type=submit]', e => e.click());
            await page.waitForSelector(`#monitor-title-${monitorName}`, {
                visible: true,
            });
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should display why degraded incident was created',
        async () => {
            const testServer = async ({ page }) => {
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.waitForSelector('#responseTime');
                await init.pageClick(page, 'input[name=responseTime]');
                await init.pageType(page, 'input[name=responseTime]', '5000');
                await page.waitForSelector('#statusCode');
                await init.pageClick(page, 'input[name=statusCode]');
                await init.pageType(page, 'input[name=statusCode]', '200');
                await init.pageClick(page, 'button[type=submit]');
                await page.waitForSelector('#save-btn');
                await page.waitForSelector('#save-btn', { visible: true });
            };

            await cluster.execute(null, testServer);

            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#closeIncident_0', {
                    visible: true,
                    timeout: 100000,
                });
                let incidentReportElement = await page.waitForSelector(
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
            });
        },
        operationTimeOut
    );

    test(
        'should display why offline incident was created',
        async () => {
            const testServer = async ({ page }) => {
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.waitForSelector('#responseTime');
                await init.pageClick(page, 'input[name=responseTime]');
                await init.pageType(page, 'input[name=responseTime]', '0');
                await page.waitForSelector('#statusCode');
                await init.pageClick(page, 'input[name=statusCode]');
                await init.pageType(page, 'input[name=statusCode]', '400');
                await init.pageClick(page, 'button[type=submit]');
                await page.waitForSelector('#save-btn');
                await page.waitForSelector('#save-btn', { visible: true });
            };

            await cluster.execute(null, testServer);

            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#closeIncident_1', {
                    visible: true,
                    timeout: 100000,
                });
                let incidentReportElement = await page.waitForSelector(
                    `#${monitorName}_IncidentReport_0`,
                    { visible: true, timeout: operationTimeOut }
                );
                incidentReportElement = await incidentReportElement.getProperty(
                    'innerText'
                );
                incidentReportElement = await incidentReportElement.jsonValue();
                expect(incidentReportElement).toMatch(/Status Code is 400./); // 'was' has been changed to 'is'. 'Response Time is' has been added to rendered page
            });
        },
        operationTimeOut
    );
});
