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
const user1 = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Profile -> Delete Account Component test', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // Register user
        await init.registerUser(user, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should not delete account with single project -> multiple users -> single owner',
        async done => {
            const projectName = 'Project1';
            const role = 'Member';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // Rename project
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('input[name=project_name]');
            await init.pageClick(page, 'input[name=project_name]', {
                clickCount: 3,
            });
            await init.pageType(page, 'input[name=project_name]', projectName);
            await page.waitForSelector('button[id=btnCreateProject]');
            await init.pageClick(page, 'button[id=btnCreateProject]');
            await page.waitForSelector(`#cb${projectName}`, {
                visible: true,
            });

            // Invite member on the project
            await page.waitForSelector('#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await page.waitForSelector(`#btn_${projectName}`);
            await init.pageClick(page, `#btn_${projectName}`);
            await page.waitForSelector('input[name=emails]');
            await init.pageClick(page, 'input[name=emails]');
            await init.pageType(page, 'input[name=emails]', user1.email);
            await page.waitForSelector(`#${role}_${projectName}`);
            await init.pageClick(page, `#${role}_${projectName}`);
            await page.waitForSelector('button[type=submit]');
            await init.pageClick(page, 'button[type=submit]');
            await page.waitForSelector(`#btn_modal_${projectName}`, {
                hidden: true,
            });

            // Navigate to profile page and delete account
            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#advanced');
            await page.$eval('#advanced', elem => elem.click());
            await page.waitForSelector('#btn_delete_account');
            await init.pageClick(page, '#btn_delete_account');
            await page.waitForSelector('#btn_confirm_delete');
            await init.pageClick(page, '#btn_confirm_delete');

            const projectDeletion = await page.waitForSelector(
                '#projectDeletion'
            );

            expect(projectDeletion).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not delete account with multiple projects -> multiple users -> single owner',
        async done => {
            const projectName = 'Project2';
            const role = 'Member';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.addProject(page, projectName);

            // Invite member on the project
            await page.waitForSelector('#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await page.waitForSelector(`#btn_${projectName}`);
            await init.pageClick(page, `#btn_${projectName}`);
            await page.waitForSelector('input[name=emails]');
            await init.pageClick(page, 'input[name=emails]');
            await init.pageType(page, 'input[name=emails]', user1.email);
            await page.waitForSelector(`#${role}_${projectName}`);
            await init.pageClick(page, `#${role}_${projectName}`);
            await page.waitForSelector('button[type=submit]');
            await init.pageClick(page, 'button[type=submit]');
            await page.waitForSelector(`#btn_modal_${projectName}`, {
                hidden: true,
            });

            // Navigate to profile page and delete account
            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#advanced');
            await page.$eval('#advanced', elem => elem.click());
            await page.waitForSelector('#btn_delete_account');
            await init.pageClick(page, '#btn_delete_account');
            await page.waitForSelector('#btn_confirm_delete');
            await init.pageClick(page, '#btn_confirm_delete');

            const projectDeletion = await page.waitForSelector(
                '#projectDeletion'
            );

            expect(projectDeletion).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should not delete account without confirmation',
        async done => {
            const role = 'Owner';
            const projectName = 'Project1';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            // Change member role -> Owner
            await page.waitForSelector('#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await page.waitForSelector('button[title="Change Role"]');
            await init.pageClick(page, 'button[title="Change Role"]');
            await page.waitForSelector(`div[title="${role}"]`);
            await init.pageClick(page, `div[title="${role}"]`);
            await page.waitForSelector('#confirmRoleChange');
            await init.pageClick(page, '#confirmRoleChange');
            await page.waitForSelector('#confirmRoleChange', {
                hidden: true,
            });

            // Switch projects and change member role -> Owner
            await init.switchProject(projectName, page);
            await page.waitForSelector('#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await page.waitForSelector('button[title="Change Role"]');
            await init.pageClick(page, 'button[title="Change Role"]');
            await page.waitForSelector(`div[title="${role}"]`);
            await init.pageClick(page, `div[title="${role}"]`);
            await page.waitForSelector('#confirmRoleChange');
            await init.pageClick(page, '#confirmRoleChange');
            await page.waitForSelector('#confirmRoleChange', {
                hidden: true,
            });

            // Navigate to profile page and delete account
            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#advanced');
            await page.$eval('#advanced', elem => elem.click());
            await page.waitForSelector('#btn_delete_account');
            await init.pageClick(page, '#btn_delete_account');
            await page.waitForSelector('#btn_confirm_delete');
            await init.pageClick(page, '#btn_confirm_delete');
            const projectDeletion = await page.waitForSelector(
                '#projectDeletion'
            );

            expect(projectDeletion).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should delete account with multiple projects -> multiple users -> multiple owners',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            // Navigate to profile page and delete account
            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#advanced');
            await page.$eval('#advanced', elem => elem.click());
            await page.waitForSelector('#btn_delete_account');
            await init.pageClick(page, '#btn_delete_account');
            await page.waitForSelector('#btn_confirm_delete');
            await init.pageClick(page, '#btn_confirm_delete');
            await page.waitForSelector('#deleteMyAccount');
            await init.pageType(page, '#deleteMyAccount', 'delete my account');
            await init.pageClick(page, '#btn_confirm_delete');
            await page.waitForNavigation();
            const url = await page.url();
            expect(url).toEqual(`${utils.ACCOUNTS_URL}/accounts/login`);

            done();
        },
        operationTimeOut
    );
});
