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
const statusPageName = utils.generateRandomString();
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
        await init.addStatusPageToProject(statusPageName, projectName, page);
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
            await page.waitForSelector('#statusPages', { visible: true });
            await page.$eval('#statusPages', e => e.click());
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true }
            );
            rowItem.click();

            await page.waitForSelector('#addMoreMonitors', { visible: true });
            await page.click('#addMoreMonitors');
            await page.waitForSelector('#monitor-0', { visible: true });
            await init.selectByText(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await page.click('#btnAddStatusPageMonitors');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbStatusPages', { visible: true });
            await page.waitForSelector(`#cb${statusPageName}`, {
                visible: true,
            });
            const elem = await page.waitForSelector('#monitor-0', {
                visible: true,
            });
            expect(elem).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
