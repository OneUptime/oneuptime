const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const newUser = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Enterprise Team SubProject API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // Register users
        await init.registerEnterpriseUser(user, page);
        await init.createUserFromAdminDashboard(newUser, page);
        await init.adminLogout(page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should add a new user to sub-project (role -> `Member`)',
        async done => {
            const subProjectName = utils.generateRandomString();

            await init.loginUser(user, page);
            //SubProject is only available for 'Growth Plan and above'
            await init.growthPlanUpgrade(page);
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await init.addSubProject(subProjectName, page);
            const role = 'Member';

            await page.waitForSelector('#teamMembers', { visible: true });
            await init.pageClick(page, '#teamMembers');
            await page.waitForSelector(`#btn_${subProjectName}`, {
                visible: true,
            });
            await init.pageClick(page, `#btn_${subProjectName}`);
            await page.waitForSelector(`#frm_${subProjectName}`, {
                visible: true,
            });
            await init.pageClick(page, `#emails_${subProjectName}`);
            await init.pageType(
                page,
                `#emails_${subProjectName}`,
                newUser.email
            );
            await init.pageClick(page, `#${role}_${subProjectName}`);
            await init.pageClick(page, `#btn_modal_${subProjectName}`);
            await page.waitForSelector(`#btn_modal_${subProjectName}`, {
                hidden: true,
            });
            done();
        },
        operationTimeOut
    );
});
