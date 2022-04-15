import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName: string = utils.generateRandomString();
const monitorName: string = utils.generateRandomString();
const statusPageName: string = utils.generateRandomString();
const projectName: string = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Page Reload', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.renameProject(projectName, page);
        await init.addStatusPageToProject(statusPageName, projectName, page);
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should reload the StatusPage and confirm there are no errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#statusPages', (e: $TSFixMe) => {
                return e.click();
            });
            const rowItem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#statusPagesListContainer > tr',
                { visible: true, timeout: init.timeout }
            );
            rowItem.click();

            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.selectDropdownValue(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#btnAddStatusPageMonitors');

            // To confirm no errors and stays on the same page on reload
            await page.reload({
                waitUntil: 'networkidle2',
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbStatusPages', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, `#cb${statusPageName}`, {
                visible: true,
                timeout: init.timeout,
            });
            const elem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#monitor-0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(elem).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
