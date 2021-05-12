const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Page Reload', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(100000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        await init.registerUser(user, page); // This automatically routes to dashboard page
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the dashboard page and confirm there are no errors',
        async done => {
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbHome', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the components page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true });
            await page.click('#components');
            await page.waitForSelector('#cbComponents', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbComponents', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the incidents page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#incidents', { visible: true });
            await page.click('#incidents');
            await page.waitForSelector('#cbIncidents', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbIncidents', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the status-pages and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#statusPages', { visible: true });
            await page.click('#statusPages');
            await page.waitForSelector('#cbStatusPages', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbStatusPages', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the onCall Duty and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#onCallDuty', { visible: true });
            await page.click('#onCallDuty');
            await page.waitForSelector('#cbOn-CallDuty', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbOn-CallDuty', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Scheduled Maintenance and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#scheduledMaintenance', {
                visible: true,
            });
            await page.click('#scheduledMaintenance');
            await page.waitForSelector('#cbScheduledMaintenanceEvent', {
                visible: true,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbScheduledMaintenanceEvent', {
                visible: true,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Reports page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#reports', { visible: true });
            await page.click('#reports');
            await page.waitForSelector('#cbReports', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbReports', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Team members and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#teamMembers', { visible: true });
            await page.click('#teamMembers');
            await page.waitForSelector('#cbTeamMembers', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbTeamMembers', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Project settings and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', { visible: true });
            await page.click('#projectSettings');
            await page.waitForSelector('#cbProjectSettings', { visible: true });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbProjectSettings', { visible: true });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Consulting and Services and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#consultingServices', {
                visible: true,
            });
            await page.click('#consultingServices');
            await page.waitForSelector('#consultingServicesPage', {
                visible: true,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#consultingServicesPage', {
                visible: true,
            });
            done();
        },
        operationTimeOut
    );
});
