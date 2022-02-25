import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const projectName = utils.generateRandomString();
const teamMember = utils.generateRandomBusinessEmail();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Page Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.renameProject(projectName, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the team member page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageClick(page, '#teamMembers');
            await init.pageClick(page, `#btn_${projectName}`);
            await init.pageType(page, `#emails_${projectName}`, teamMember);
            await init.pageClick(page, '#member');
            await init.pageClick(page, `#btn_modal_${projectName}`);
            await init.pageWaitForSelector(page, `#frm_${projectName}`, {
                hidden: true,
            });
            await init.pageClick(page, `#${teamMember.split('@')[0]}-profile`);
            await init.pageWaitForSelector(page, '#cbTeamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(
                page,
                `#${teamMember.split('@')[0]}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            //To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbTeamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                `#${teamMember.split('@')[0]}`,
                { visible: true, timeout: init.timeout }
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
