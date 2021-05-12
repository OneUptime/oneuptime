const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const onCallName = utils.generateRandomString();
const projectName = utils.generateRandomString();

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
        await init.renameProject(projectName, page);
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the incidents page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#onCallDuty', {
                visible: true,
            });
            await page.$eval('#onCallDuty', elem => elem.click());
            const createScheduleBtn = `#btnCreateSchedule_${projectName}`;
            await page.waitForSelector(createScheduleBtn, {
                visible: true,
            });
            await page.$eval(createScheduleBtn, elem => elem.click());

            await page.waitForSelector('#name', { visible: true });
            await init.pageType(page, '#name', onCallName);
            await page.click('#btnCreateSchedule');
            await page.waitForSelector('#name', { hidden: true });

            await page.waitForSelector('#viewOnCallSchedule', {
                visible: true,
            });
            await page.click('#viewOnCallSchedule');
            await page.waitForSelector('#scheduleMonitor_0', { visible: true });
            await page.click('#scheduleMonitor_0');
            await page.waitForSelector('#btnSaveMonitors', { visible: true });
            await page.click('#btnSaveMonitors');

            await init.selectByText(
                '.css-1uccc91-singleValue',
                'Test Name',
                page
            );
            await page.waitForSelector('#saveSchedulePolicy', {
                visible: true,
            });
            await page.click('#saveSchedulePolicy');

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbOn-CallDuty', { visible: true });
            await page.waitForSelector(`#cb${onCallName}`, { visible: true });

            const spanElement = await page.waitForSelector('#onCallDutyNote', {
                visible: true,
            });
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
