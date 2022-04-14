import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const groupName: string = utils.generateRandomString();
/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Page Reload', () => {
    const operationTimeOut = 100000;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(100000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();

        await init.registerUser(user, page); // This automatically routes to dashboard page
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should reload the probe page and confirm there are no errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageClick(page, '#more');

            await init.pageClick(page, '#teamGroups');

            await init.pageClick(page, '#btn_Add_SubProjects');

            await init.pageType(page, '#groupName', groupName);
            await init.selectDropdownValue('#componentList', 'Test Name', page);

            await init.pageClick(page, '#btnAddGroup');
            const spanElement = await page.waitForSelector(
                `#sub_project_name_${groupName}`
            );
            expect(spanElement).toBeDefined();
            //To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbProjectSettings', { visible: true });
            await page.waitForSelector('#cbTeamGroups', { visible: true });
            const spanElement2 = await page.waitForSelector(
                `#sub_project_name_${groupName}`
            );
            expect(spanElement2).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
