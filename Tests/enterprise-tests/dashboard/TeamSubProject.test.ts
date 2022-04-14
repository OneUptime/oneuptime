import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
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
        await page.setUserAgent(utils.agent);
        // Register users
        await init.registerEnterpriseUser(user, page);
        await init.createUserFromAdminDashboard(newUser, page);
        await init.adminLogout(page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should add a new user to sub-project (role -> `Member`)',
        async (done: $TSFixMe) => {
            const subProjectName = utils.generateRandomString();

            await init.loginUser(user, page);
            //SubProject is only available for 'Growth Plan and above'
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await init.addSubProject(subProjectName, page);
            const role: string = 'Member';

            await init.pageWaitForSelector(page, '#teamMembers', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(page, `#btn_${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#btn_${subProjectName}`);
            await init.pageWaitForSelector(page, `#frm_${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#emails_${subProjectName}`);

            await init.pageType(
                page,
                `#emails_${subProjectName}`,
                newUser.email
            );

            await init.pageClick(page, `#${role}_${subProjectName}`);

            await init.pageClick(page, `#btn_modal_${subProjectName}`);
            await init.pageWaitForSelector(
                page,
                `#btn_modal_${subProjectName}`,
                {
                    hidden: true,
                }
            );
            done();
        },
        operationTimeOut
    );
});
