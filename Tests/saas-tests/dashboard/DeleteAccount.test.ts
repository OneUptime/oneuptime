import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const user1: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const projectName = utils.generateRandomString();
const projectName2 = utils.generateRandomString();

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

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should not delete account with single project -> multiple users -> single owner',
        async (done: $TSFixMe) => {
            const role: string = 'Member';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // Rename project

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, 'input[name=project_name]');
            await init.pageClick(page, 'input[name=project_name]', {
                clickCount: 3,
            });

            await init.pageType(page, 'input[name=project_name]', projectName);

            await init.pageWaitForSelector(page, 'button[id=btnCreateProject]');

            await init.pageClick(page, 'button[id=btnCreateProject]');
            await init.pageWaitForSelector(page, `#cb${projectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            // Invite member on the project

            await init.pageWaitForSelector(page, '#teamMembers');

            await init.pageClick(page, '#teamMembers');

            await init.pageWaitForSelector(page, `#btn_${projectName}`);

            await init.pageClick(page, `#btn_${projectName}`);

            await init.pageWaitForSelector(page, 'input[name=emails]');

            await init.pageClick(page, 'input[name=emails]');

            await init.pageType(page, 'input[name=emails]', user1.email);

            await init.pageWaitForSelector(page, `#${role}_${projectName}`);

            await init.pageClick(page, `#${role}_${projectName}`);

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`, {
                hidden: true,
            });

            // Navigate to profile page and delete account

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#advanced');
            await init.page$Eval(page, '#advanced', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#btn_delete_account');

            await init.pageClick(page, '#btn_delete_account');

            await init.pageWaitForSelector(page, '#btn_confirm_delete');

            await init.pageClick(page, '#btn_confirm_delete');

            const projectDeletion = await init.pageWaitForSelector(
                page,
                '#projectOwnership' // Updated UI
            );

            expect(projectDeletion).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not delete account with multiple projects -> multiple users -> single owner',
        async (done: $TSFixMe) => {
            const role: string = 'Member';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.addProject(page, projectName2);
            // Invite member on the project

            await init.pageWaitForSelector(page, '#teamMembers');

            await init.pageClick(page, '#teamMembers');

            await init.pageWaitForSelector(page, `#btn_${projectName2}`);

            await init.pageClick(page, `#btn_${projectName2}`);

            await init.pageWaitForSelector(page, 'input[name=emails]');

            await init.pageClick(page, 'input[name=emails]');

            await init.pageType(page, 'input[name=emails]', user1.email);

            await init.pageWaitForSelector(page, `#${role}_${projectName2}`);

            await init.pageClick(page, `#${role}_${projectName2}`);

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, `#btn_modal_${projectName2}`, {
                hidden: true,
            });

            // Navigate to profile page and delete account

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#advanced');
            await init.page$Eval(page, '#advanced', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#btn_delete_account');

            await init.pageClick(page, '#btn_delete_account');

            await init.pageWaitForSelector(page, '#btn_confirm_delete');

            await init.pageClick(page, '#btn_confirm_delete');

            const projectDeletion = await init.pageWaitForSelector(
                page,
                '#projectOwnership'
            );

            expect(projectDeletion).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should not delete account without confirmation',
        async (done: $TSFixMe) => {
            const role: string = 'Owner';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            // Change member role -> Owner

            await init.pageWaitForSelector(page, '#teamMembers');

            await init.pageClick(page, '#teamMembers');
            const emailSelector = user1.email.split('@')[0];

            await init.pageClick(page, `#changeRole_${emailSelector}`);

            await init.pageClick(page, `#${role}`);

            await init.pageWaitForSelector(page, '#confirmRoleChange');

            await init.pageClick(page, '#confirmRoleChange');
            await init.pageWaitForSelector(page, '#confirmRoleChange', {
                hidden: true,
            });

            // Switch projects and change member role -> Owner
            await init.switchProject(projectName, page);

            await init.pageWaitForSelector(page, '#teamMembers');

            await init.pageClick(page, '#teamMembers');

            await init.pageClick(page, `#changeRole_${emailSelector}`);

            await init.pageClick(page, `#${role}`);

            await init.pageWaitForSelector(page, '#confirmRoleChange');

            await init.pageClick(page, '#confirmRoleChange');
            await init.pageWaitForSelector(page, '#confirmRoleChange', {
                hidden: true,
            });

            // Navigate to profile page and delete account

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#advanced');
            await init.page$Eval(page, '#advanced', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#btn_delete_account');

            await init.pageClick(page, '#btn_delete_account');

            await init.pageWaitForSelector(page, '#btn_confirm_delete');

            await init.pageClick(page, '#btn_confirm_delete');

            const projectDeletion = await init.pageWaitForSelector(
                page,
                '#projectDeletion'
            );

            expect(projectDeletion).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should delete account with multiple projects -> multiple users -> multiple owners',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            // Navigate to profile page and delete account

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#advanced');
            await init.page$Eval(page, '#advanced', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#btn_delete_account');

            await init.pageClick(page, '#btn_delete_account');

            await init.pageWaitForSelector(page, '#btn_confirm_delete');

            await init.pageClick(page, '#btn_confirm_delete');

            await init.pageWaitForSelector(page, '#deleteMyAccount');

            await init.pageType(page, '#deleteMyAccount', 'delete my account');

            await init.pageClick(page, '#btn_confirm_delete');

            await init.pageClick(page, '#close');
            await page.waitForNavigation();
            const url = await page.url();
            expect(url).toEqual(`${utils.ACCOUNTS_URL}/accounts/login`);

            done();
        },
        operationTimeOut
    );
});
