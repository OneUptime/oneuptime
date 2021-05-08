const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

// user credentials
const email = utils.generateRandomBusinessEmail();
const teamEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
const newProjectName = 'Test';

const user = {
    email,
    password,
};
const memberUser = {
    email: teamEmail,
    password: password,
};

let browser, page;

describe('Project Settings', () => {
    const operationTimeOut = 50000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // user
        await init.registerUser(user, page);

        await init.renameProject(newProjectName, page);
        await init.growthPlanUpgrade(page); // Growth Plan is needed for subproject.
        await page.goto(utils.DASHBOARD_URL);
        await init.addUserToProject(
            {
                email: teamEmail,
                role: 'Member',
                subProjectName: newProjectName,
            },
            page
        );
        await page.waitForSelector('#added_team_members');
        await init.logout(page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should show unauthorised modal when trying to save project name for non-admins',
        async done => {
            await init.registerAndLoggingTeamMember(memberUser, page);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('input[name=project_name]');
            await page.waitForSelector('#btnCreateProject', {
                visible: true,
            });
            await page.click('#btnCreateProject');
            const unauthorisedModal = await page.waitForSelector(
                '#unauthorisedModal',
                { visible: true }
            );

            expect(unauthorisedModal).toBeDefined();
            await init.logout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should show delete project modal and click on cancel',
        async done => {
            await init.loginUser({ email, password }, page);
            // click on settings
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            // click on advanced
            await page.waitForSelector('#advanced', {
                visible: true,
            });
            await page.click('#advanced');
            // click on delete button
            await page.waitForSelector(`#delete-${newProjectName}`, {
                visible: true,
            });
            await page.click(`#delete-${newProjectName}`);
            // confirm the delete modal comes up and the form is available
            await page.waitForSelector('#btnDeleteProject', {
                visible: true,
            });
            await page.click('#btnDeleteProject');
            await page.waitForSelector(`#delete-project-form`, {
                visible: true,
            });
            // fill the feedback form
            await page.click(`textarea[id=feedback]`);
            await page.type(`textarea[id=feedback]`, `This is a test deletion`);
            // click submit button
            await page.waitForSelector('#btnDeleteProject', {
                visible: true,
            });
            await page.click('#btnDeleteProject');

            // find the button for creating a project and expect it to be defined
            const createProjectBtn = await page.waitForSelector(
                '#createButton',
                {
                    visible: true,
                }
            );
            expect(createProjectBtn).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
