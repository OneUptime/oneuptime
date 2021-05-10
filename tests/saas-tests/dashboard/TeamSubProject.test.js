const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

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
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

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
    test('should add a new user to parent project and all sub-projects (role -> `Administrator`)', async done => {
        await page.goto(utils.DASHBOARD_URL);
        const role = 'Administrator';

        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${projectName}`);
        await page.click(`#btn_${projectName}`);
        await page.waitForSelector(`#frm_${projectName}`);
        await page.waitForSelector(`#emails_${projectName}`);
        await page.click(`#emails_${projectName}`);
        await page.type(`#emails_${projectName}`, anotherEmail);
        await page.click(`#${role}_${projectName}`);
        await page.waitForSelector(`#btn_modal_${projectName}`);
        await page.click(`#btn_modal_${projectName}`);
        await page.waitForSelector('#btnConfirmInvite');
        await page.click('#btnConfirmInvite');
        await page.waitForSelector(`#btn_modal_${projectName}`, {
            hidden: true,
        });

        await page.waitForSelector(`#count_${projectName}`);
        const memberCount = await page.$eval(
            `#count_${projectName}`,
            elem => elem.textContent
        );
        expect(memberCount).toEqual('Page 1 of 1 (2 Team Members)');

        done();
    }, 200000);

    test('should not allow project owner to add other project owners', async done => {
        await page.goto(utils.DASHBOARD_URL);
        const role = 'Owner';

        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${projectName}`);
        await page.click(`#btn_${projectName}`);
        await page.waitForSelector(`#frm_${projectName}`);
        const elementHandle = await page.$(`#${role}_${projectName}`);
        expect(elementHandle).toEqual(null);
        done();
    }, 200000);

    test('should not allow administrator to add project owners', async done => {
        await page.goto(utils.DASHBOARD_URL);
        const role = 'Owner';

        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${projectName}`);
        await page.click(`#btn_${projectName}`);
        await page.waitForSelector(`#frm_${projectName}`);
        const elementHandle = await page.$(`#${role}_${projectName}`);
        expect(elementHandle).toEqual(null);

        done();
    }, 200000);

    test('should add a new user to sub-project (role -> `Member`)', async done => {
        await page.goto(utils.DASHBOARD_URL);
        const role = 'Member';

        await page.waitForSelector('#teamMembers', { visible: true });
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${subProjectName}`);
        await page.click(`#btn_${subProjectName}`);
        await page.waitForSelector(`#frm_${subProjectName}`);
        await page.click(`#emails_${subProjectName}`);
        await page.type(`#emails_${subProjectName}`, newEmail);
        await page.click(`#${role}_${subProjectName}`);
        await page.waitForSelector(`#btn_modal_${subProjectName}`);
        await page.click(`#btn_modal_${subProjectName}`);
        await page.waitForSelector(`#btn_modal_${subProjectName}`, {
            hidden: true,
        });

        await page.waitForSelector(`#count_${subProjectName}`);
        const memberCount = await page.$eval(
            `#count_${subProjectName}`,
            elem => elem.textContent
        );
        expect(memberCount).toEqual('Page 1 of 1 (3 Team Members)');

        done();
    }, 200000);

    test(
        'should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)',
        async done => {
            const newRole = 'Member';
            const emailSelector = anotherEmail.split('@')[0];
            await page.goto(utils.DASHBOARD_URL);

            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            await page.waitForSelector(`#changeRole_${emailSelector}`);
            await page.click(`#changeRole_${emailSelector}`);
            await page.waitForSelector(`div[title="${newRole}"]`);
            await page.click(`div[title="${newRole}"]`);

            const member = await page.waitForSelector(
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
            await page.goto(utils.DASHBOARD_URL);

            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            await page.waitForSelector(`#removeMember__${emailSelector}`, {
                visible: true,
            });
            await page.click(`#removeMember__${emailSelector}`);
            await page.waitForSelector('#removeTeamUser');
            await page.click('#removeTeamUser');
            await page.waitForSelector('#removeTeamUser', {
                hidden: true,
            });

            await page.waitForSelector(`#count_${projectName}`);
            const memberCount = await page.$eval(
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
            await page.goto(utils.DASHBOARD_URL);

            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            await page.waitForSelector(`button[id=btn_${projectName}]`);
            await page.click(`button[id=btn_${projectName}]`);
            await page.waitForSelector('input[name=emails]');
            await page.click('input[name=emails]');
            await page.type('input[name=emails]', nonBusinessEmail);
            await page.waitForSelector(`#${role}_${projectName}`);
            await page.click(`#${role}_${projectName}`);
            await page.waitForSelector(`#btn_modal_${projectName}`);
            await page.click(`#btn_modal_${projectName}`);
            let spanElement = await page.waitForSelector(
                `#frm_${projectName} span#field-error`
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

            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');

            // Invite a team member
            await page.waitForSelector(`#btn_${projectName}`);
            await page.click(`#btn_${projectName}`);
            await page.waitForSelector(`#frm_${projectName}`);
            await page.waitForSelector(`#emails_${projectName}`);
            await page.click(`#emails_${projectName}`);
            await page.type(`#emails_${projectName}`, anotherEmail);
            await page.click(`#Member_${projectName}`);
            await page.waitForSelector(`#btn_modal_${projectName}`);
            await page.click(`#btn_modal_${projectName}`);
            await page.waitForSelector('#btnConfirmInvite');
            await page.click('#btnConfirmInvite');
            await page.waitForSelector(`#btn_modal_${projectName}`, {
                hidden: true,
            });

            await page.waitForSelector(`#changeRole_${memberEmailSelector}`);
            const oldMemberRole = await page.$eval(
                `#Member_${memberEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(oldMemberRole).toEqual('Member');
            const oldOwnerRole = await page.$eval(
                `#Owner_${ownerEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(oldOwnerRole).toEqual('Owner');

            await page.click(`#changeRole_${memberEmailSelector}`);
            await page.waitForSelector(`div[title="${newRole}"]`);
            await page.click(`div[title="${newRole}"]`);
            await page.waitForSelector('#confirmRoleChange');
            await page.click('#confirmRoleChange');
            await page.waitForTimeout(5000);
            const newMemberRole = await page.$eval(
                `#Owner_${memberEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(newMemberRole).toEqual('Owner');
            const newOwnerRole = await page.$eval(
                `#Administrator_${ownerEmailSelector}`,
                elem => elem.innerHTML
            );
            expect(newOwnerRole).toEqual('Administrator');

            done();
        },
        operationTimeOut
    );
});
