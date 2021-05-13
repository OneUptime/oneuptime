const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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

describe('Fyipe Page Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

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
            await page.waitForSelector(`#frm_${projectName}`, {
                hidden: true,
            });
            await init.pageClick(page, `#${teamMember.split('@')[0]}-profile`);
            await page.waitForSelector('#cbTeamMembers', { visible: true });
            await page.waitForSelector(`#${teamMember.split('@')[0]}`, {
                visible: true,
            });

            //To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbTeamMembers', { visible: true });
            const spanElement = await page.waitForSelector(
                `#${teamMember.split('@')[0]}`,
                { visible: true }
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
