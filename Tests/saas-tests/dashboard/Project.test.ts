import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

// user credentials
const email: $TSFixMe = utils.generateRandomBusinessEmail();
const teamEmail: $TSFixMe = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const newProjectName: string = 'Test';

const user: $TSFixMe = {
    email,
    password,
};
const user2: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password,
};
const memberUser: $TSFixMe = {
    email: teamEmail,
    password: password,
};

let browser: $TSFixMe, page: $TSFixMe;

describe('Project Settings', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        await init.renameProject(newProjectName, page);
        await init.growthPlanUpgrade(page); // Growth Plan is needed for subproject.
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await init.addUserToProject(
            {
                email: teamEmail,
                role: 'Member',
                subProjectName: newProjectName,
            },
            page
        );

        await init.pageWaitForSelector(page, '#added_team_members');
        await init.saasLogout(page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show unauthorised modal when trying to save project name for non-admins',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(memberUser, page);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, 'input[name=project_name]');
            await init.pageWaitForSelector(page, '#btnCreateProject', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnCreateProject');
            const unauthorisedModal: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#unauthorisedModal',
                { visible: true, timeout: init.timeout }
            );

            expect(unauthorisedModal).toBeDefined();
            await init.saasLogout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should show delete project modal and click on cancel',
        async (done: $TSFixMe) => {
            await init.loginUser({ email, password }, page);
            // click on settings
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            // click on advanced
            await init.pageWaitForSelector(page, '#advanced', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#advanced');
            // click on delete button
            await init.pageWaitForSelector(page, `#delete-${newProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#delete-${newProjectName}`);
            // confirm the delete modal comes up and the form is available
            await init.pageWaitForSelector(page, '#btnDeleteProject', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnDeleteProject');
            await init.pageWaitForSelector(page, `#delete-project-form`, {
                visible: true,
                timeout: init.timeout,
            });
            // fill the feedback form

            await init.pageClick(page, `textarea[id=feedback]`);

            await init.pageType(
                page,
                `textarea[id=feedback]`,
                `This is a test deletion`
            );
            // click submit button
            await init.pageWaitForSelector(page, '#btnDeleteProject', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnDeleteProject');

            // find the button for creating a project and expect it to be defined
            const createProjectBtn: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#createButton',
                {
                    visible: true,
                }
            );
            expect(createProjectBtn).toBeDefined();
            await init.saasLogout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should show all projects not just a limit of 10 projects',
        async (done: $TSFixMe) => {
            //register user
            await init.registerUser(user2, page);
            //adding project

            await init.addProject(page, 'project1');

            await init.addProject(page, 'project2');

            await init.addProject(page, 'project3');

            await init.addProject(page, 'project4');

            await init.addProject(page, 'project5');

            await init.addProject(page, 'project6');

            await init.addProject(page, 'project7');

            await init.addProject(page, 'project8');

            await init.addProject(page, 'project9');

            await init.addProject(page, 'project10');

            await init.addProject(page, 'project11');

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#AccountSwitcherId');

            await init.pageClick(page, '#AccountSwitcherId');

            const parentContainer: string = '#accountSwitcher';
            await init.pageWaitForSelector(page, parentContainer, {
                visible: true,
                timeout: init.timeout,
            });
            const childCount: $TSFixMe = await init.page$Eval(
                page,
                parentContainer,
                (el: $TSFixMe) => el.childElementCount
            );
            expect(childCount).toEqual(13);
            done();
        },
        init.timeout
    );
});
