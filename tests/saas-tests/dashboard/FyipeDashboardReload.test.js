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
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

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
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbHome', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the components page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#components');
            await page.waitForSelector('#cbComponents', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbComponents', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the incidents page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#incidents', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#incidents');
            await page.waitForSelector('#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbIncidents', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the status-pages and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#statusPages', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#cbStatusPages', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbStatusPages', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the onCall Duty and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#onCallDuty');
            await page.waitForSelector('#cbOn-CallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbOn-CallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Scheduled Maintenance and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#scheduledMaintenance');
            await page.waitForSelector('#cbScheduledMaintenanceEvent', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbScheduledMaintenanceEvent', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Reports page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#reports', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#reports');
            await page.waitForSelector('#cbReports', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbReports', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Team members and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#teamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#teamMembers');
            await page.waitForSelector('#cbTeamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbTeamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Project settings and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#cbProjectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbProjectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should reload the Consulting and Services and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#consultingServices', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#consultingServices');
            await page.waitForSelector('#consultingServicesPage', {
                visible: true,
                timeout: init.timeout,
            });
            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#consultingServicesPage', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );
});
