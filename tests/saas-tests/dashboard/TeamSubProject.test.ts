import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser, page;

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
// another user credentials
const anotherEmail = utils.generateRandomBusinessEmail();

const subProjectName = utils.generateRandomString();

describe('Team API With SubProjects', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);
        // Growth Plan is needed for subproject
        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page);

        // add sub-project
        await init.addSubProject(subProjectName, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });
    // No need for switchProject as the tests were carried out in the created project from 'email' and 'password'
    test(
        'should add a new user to parent project and all sub-projects (role -> `Administrator`)',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            const role = 'Administrator';

            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(page, `#btn_${projectName}`);
            await init.pageClick(page, `#btn_${projectName}`);
            await init.pageWaitForSelector(page, `#frm_${projectName}`);
            await init.pageWaitForSelector(page, `#emails_${projectName}`);
            await init.pageClick(page, `#emails_${projectName}`);
            await init.pageType(page, `#emails_${projectName}`, anotherEmail);
            await init.pageClick(page, `#${role}_${projectName}`);
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`);
            await init.pageClick(page, `#btn_modal_${projectName}`);
            await init.pageWaitForSelector(page, '#btnConfirmInvite');
            await init.pageClick(page, '#btnConfirmInvite');
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`, {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#count_${projectName}`);
            const memberCount = await init.page$Eval(
                page,
                `#count_${projectName}`,
                elem => elem.textContent
            );
            expect(memberCount).toEqual('Page 1 of 1 (2 Team Members)');

            done();
        },
        init.timeout
    );

    test(
        'should not allow project owner to add other project owners',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            const role = 'Owner';

            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(page, `#btn_${projectName}`);
            await init.pageClick(page, `#btn_${projectName}`);
            await init.pageWaitForSelector(page, `#frm_${projectName}`);
            const elementHandle = await init.page$(
                page,
                `#${role}_${projectName}`,
                { hidden: true }
            );
            expect(elementHandle).toEqual(null);
            done();
        },
        init.timeout
    );

    test(
        'should not allow administrator to add project owners',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            const role = 'Owner';

            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(page, `#btn_${projectName}`);
            await init.pageClick(page, `#btn_${projectName}`);
            await init.pageWaitForSelector(page, `#frm_${projectName}`);
            const elementHandle = await init.page$(
                page,
                `#${role}_${projectName}`,
                { hidden: true }
            );
            expect(elementHandle).toEqual(null);

            done();
        },
        init.timeout
    );

    test(
        'should add a new user to sub-project (role -> `Member`)',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageClick(page, '#projectFilterToggle');
            await init.pageClick(page, `#project-${subProjectName}`);
            const role = 'Member';

            await init.pageWaitForSelector(page, '#teamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(page, `#btn_${subProjectName}`);
            await init.pageClick(page, `#btn_${subProjectName}`);
            await init.pageWaitForSelector(page, `#frm_${subProjectName}`);
            await init.pageClick(page, `#emails_${subProjectName}`);
            await init.pageType(page, `#emails_${subProjectName}`, newEmail);
            await init.pageClick(page, `#${role}_${subProjectName}`);
            await init.pageWaitForSelector(
                page,
                `#btn_modal_${subProjectName}`
            );
            await init.pageClick(page, `#btn_modal_${subProjectName}`);
            await init.pageWaitForSelector(
                page,
                `#btn_modal_${subProjectName}`,
                {
                    hidden: true,
                }
            );

            await init.pageWaitForSelector(page, `#count_${subProjectName}`);
            const memberCount = await init.page$Eval(
                page,
                `#count_${subProjectName}`,
                elem => elem.textContent
            );
            expect(memberCount).toEqual('Page 1 of 1 (1 Team Member)'); // Only one member in subproject

            done();
        },
        init.timeout
    );

    test(
        'should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)',
        async done => {
            const newRole = 'Member';
            const emailSelector = anotherEmail.split('@')[0];
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageClick(page, '#projectFilterToggle');
            await init.pageClick(page, `#project-${projectName}`);
            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(
                page,
                `#changeRole_${emailSelector}`
            );
            await init.pageClick(page, `#changeRole_${emailSelector}`);
            await init.pageWaitForSelector(page, `#${newRole}`);
            await init.pageClick(page, `#${newRole}`);

            const member = await init.pageWaitForSelector(
                page,
                `#${newRole}_${emailSelector}`,
                {
                    visible: true,
                }
            );
            expect(member).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should remove user from project Team Members and all sub-projects.',
        async done => {
            const emailSelector = anotherEmail.split('@')[0];
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(
                page,
                `#removeMember__${emailSelector}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.pageClick(page, `#removeMember__${emailSelector}`);
            await init.pageWaitForSelector(page, '#removeTeamUser');
            await init.pageClick(page, '#removeTeamUser');
            await init.pageWaitForSelector(page, '#removeTeamUser', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#count_${projectName}`);
            const memberCount = await init.page$Eval(
                page,
                `#count_${projectName}`,
                elem => elem.textContent
            );
            expect(memberCount).toEqual('Page 1 of 1 (1 Team Member)');

            done();
        },
        operationTimeOut
    );

    test(
        'should not add team members without business emails',
        async done => {
            const role = 'Member';
            const nonBusinessEmail =
                utils.generateRandomString() + '@gmail.com';
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');
            await init.pageWaitForSelector(
                page,
                `button[id=btn_${projectName}]`
            );
            await init.pageClick(page, `button[id=btn_${projectName}]`);
            await init.pageWaitForSelector(page, 'input[name=emails]');
            await init.pageClick(page, 'input[name=emails]');
            await init.pageType(page, 'input[name=emails]', nonBusinessEmail);
            await init.pageWaitForSelector(page, `#${role}_${projectName}`);
            await init.pageClick(page, `#${role}_${projectName}`);
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`);
            await init.pageClick(page, `#btn_modal_${projectName}`);
            await init.pageClick(page, `#btnConfirmInvite`);
            let spanElement = await init.pageWaitForSelector(
                page,
                `#businessEmailError`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(
                'Please enter business emails of the members.'
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should assign a new owner of the project',
        async done => {
            const newRole = 'Owner';
            const memberEmailSelector = anotherEmail.split('@')[0];
            const ownerEmailSelector = email.split('@')[0];

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#teamMembers');
            await init.pageClick(page, '#teamMembers');

            // Invite a team member
            await init.pageWaitForSelector(page, `#btn_${projectName}`);
            await init.pageClick(page, `#btn_${projectName}`);
            await init.pageWaitForSelector(page, `#frm_${projectName}`);
            await init.pageWaitForSelector(page, `#emails_${projectName}`);
            await init.pageClick(page, `#emails_${projectName}`);
            await init.pageType(page, `#emails_${projectName}`, anotherEmail);
            await init.pageClick(page, `#Member_${projectName}`);
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`);
            await init.pageClick(page, `#btn_modal_${projectName}`);
            await init.pageWaitForSelector(page, '#btnConfirmInvite');
            await init.pageClick(page, '#btnConfirmInvite');
            await init.pageWaitForSelector(page, `#btn_modal_${projectName}`, {
                hidden: true,
            });

            await init.pageWaitForSelector(
                page,
                `#changeRole_${memberEmailSelector}`
            );
            const oldMemberRole = await init.page$Eval(
                page,
                `#Member_${memberEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(oldMemberRole).toEqual('Member');
            const oldOwnerRole = await init.page$Eval(
                page,
                `#Owner_${ownerEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(oldOwnerRole).toEqual('Owner');

            await init.pageClick(page, `#changeRole_${memberEmailSelector}`);
            await init.pageWaitForSelector(page, `#${newRole}`);
            await init.pageClick(page, `#${newRole}`);
            await init.pageWaitForSelector(page, '#confirmRoleChange');
            await init.pageClick(page, '#confirmRoleChange');

            const newMemberRole = await init.page$Eval(
                page,
                `#Owner_${memberEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(newMemberRole).toEqual('Owner');
            const newOwnerRole = await init.page$Eval(
                page,
                `#Administrator_${ownerEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(newOwnerRole).toEqual('Administrator');

            done();
        },
        operationTimeOut
    );
});
