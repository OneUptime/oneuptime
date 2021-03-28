const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const teamEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
const newProjectName = 'Test';

describe('Project Settings', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute(
            { teamEmail, password },
            async ({ page, data }) => {
                const user = {
                    email,
                    password,
                };
                const memberUser = {
                    email: data.teamEmail,
                    password: data.password,
                };

                // user
                await init.registerUser(user, page);
                await init.logout(page);
                await init.registerUser(memberUser, page);
                await init.logout(page);
                await init.loginUser({ email, password }, page);
                await init.renameProject(newProjectName, page);
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
            }
        );

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show unauthorised modal when trying to save project name for non-admins',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.loginUser({ email: teamEmail, password }, page);
                await init.switchProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL);
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
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should show delete project modal and click on cancel',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.loginUser({ email, password }, page);
                await page.goto(utils.DASHBOARD_URL);
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
                await page.type(
                    `textarea[id=feedback]`,
                    `This is a test deletion`
                );
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
            });
            done();
        },
        operationTimeOut
    );
});
