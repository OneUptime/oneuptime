// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

// user credentials
const email = utils.generateRandomBusinessEmail();
const teamEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
const newProjectName = 'Test';

const user = {
    email,
    password,
};
const user2 = {
    email: utils.generateRandomBusinessEmail(),
    password,
};
const memberUser = {
    email: teamEmail,
    password: password,
};

let browser: $TSFixMe, page: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Project Settings', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
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
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#added_team_members');
        await init.saasLogout(page);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show unauthorised modal when trying to save project name for non-admins',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(memberUser, page);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[name=project_name]');
            await init.pageWaitForSelector(page, '#btnCreateProject', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnCreateProject');
            const unauthorisedModal = await init.pageWaitForSelector(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show delete project modal and click on cancel',
        async (done: $TSFixMe) => {
            await init.loginUser({ email, password }, page);
            // click on settings
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // click on advanced
            await init.pageWaitForSelector(page, '#advanced', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#advanced');
            // click on delete button
            await init.pageWaitForSelector(page, `#delete-${newProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#delete-${newProjectName}`);
            // confirm the delete modal comes up and the form is available
            await init.pageWaitForSelector(page, '#btnDeleteProject', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnDeleteProject');
            await init.pageWaitForSelector(page, `#delete-project-form`, {
                visible: true,
                timeout: init.timeout,
            });
            // fill the feedback form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `textarea[id=feedback]`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnDeleteProject');

            // find the button for creating a project and expect it to be defined
            const createProjectBtn = await init.pageWaitForSelector(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show all projects not just a limit of 10 projects',
        async (done: $TSFixMe) => {
            //register user
            await init.registerUser(user2, page);
            //adding project
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project1"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project1');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project2"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project2');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project3"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project3');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project4"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project4');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project5"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project5');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project6"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project6');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project7"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project7');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project8"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project8');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project9"' is not assignable to... Remove this comment to see the full error message
            await init.addProject(page, 'project9');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project10"' is not assignable t... Remove this comment to see the full error message
            await init.addProject(page, 'project10');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project11"' is not assignable t... Remove this comment to see the full error message
            await init.addProject(page, 'project11');

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#AccountSwitcherId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#AccountSwitcherId');

            const parentContainer = '#accountSwitcher';
            await init.pageWaitForSelector(page, parentContainer, {
                visible: true,
                timeout: init.timeout,
            });
            const childCount = await init.page$Eval(
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
