const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('Incident Reports API', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
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
            await page.type('input[id=name]', monitorName);
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', {visible: true});
            await page.$eval('#url', e => e.click());
            await page.type('#url', utils.HTTP_TEST_SERVER_URL);
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
                await page.click('input[name=responseTime]');
                await page.type('input[name=responseTime]', '5000');
                await page.waitForSelector('#statusCode');
                await page.click('input[name=statusCode]');
                await page.type('input[name=statusCode]', '200');
                await page.click('button[type=submit]');
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
                await page.click('input[name=responseTime]');
                await page.type('input[name=responseTime]', '0');
                await page.waitForSelector('#statusCode');
                await page.click('input[name=statusCode]');
                await page.type('input[name=statusCode]', '400');
                await page.click('button[type=submit]');
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
