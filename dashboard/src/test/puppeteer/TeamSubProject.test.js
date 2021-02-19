const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
// another user credentials
const anotherEmail = utils.generateRandomBusinessEmail();
const anotherPassword = '1234567890';

const subProjectName = utils.generateRandomString();

describe('Team API With SubProjects', () => {
    const operationTimeOut = 100000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        const task = async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            // user
            await init.registerUser(user, page);
        };

        await cluster.execute(
            {
                email,
                password,
            },
            task
        );

        await cluster.execute(
            {
                email: newEmail,
                password: newPassword,
            },
            task
        );

        await cluster.execute(
            {
                email: anotherEmail,
                password: anotherPassword,
            },
            task
        );

        await cluster.execute(null, async ({ page }) => {
            const user = { email, password };
            await init.loginUser(user, page);
            await init.addGrowthProject(projectName, page);

            // add sub-project
            await init.addSubProject(subProjectName, page);
        });
        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test('should add a new user to parent project and all sub-projects (role -> `Administrator`)', async done => {
        await cluster.execute(
            { email, password, anotherEmail, projectName, isParentUser: true },
            async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };
                await page.goto(utils.DASHBOARD_URL);

                await init.loginUser(user, page);
                await init.switchProject(data.projectName, page);

                const role = 'Administrator';

                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${data.projectName}`);
                await page.click(`#btn_${data.projectName}`);
                await page.waitForSelector(`#frm_${data.projectName}`);
                await page.waitForSelector(`#emails_${data.projectName}`);
                await page.click(`#emails_${data.projectName}`);
                await page.type(
                    `#emails_${data.projectName}`,
                    data.anotherEmail
                );
                await page.click(`#${role}_${data.projectName}`);
                await page.waitForSelector(`#btn_modal_${data.projectName}`);
                await page.click(`#btn_modal_${data.projectName}`);
                await page.waitForSelector('#btnConfirmInvite');
                await page.click('#btnConfirmInvite');
                await page.waitForSelector(`#btn_modal_${data.projectName}`, {
                    hidden: true,
                });

                await page.waitForSelector(`#count_${data.projectName}`);
                const memberCount = await page.$eval(
                    `#count_${data.projectName}`,
                    elem => elem.textContent
                );
                expect(memberCount).toEqual('Page 1 of 1 (2 Team Members)');
            }
        );
        done();
    }, 200000);

    test('should not allow project owner to add other project owners', async () => {
        return await cluster.execute(
            { email, password, projectName, isParentUser: true },
            async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };
                await page.goto(utils.DASHBOARD_URL);

                await init.loginUser(user, page);
                await init.switchProject(data.projectName, page);

                const role = 'Owner';

                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${data.projectName}`);
                await page.click(`#btn_${data.projectName}`);
                await page.waitForSelector(`#frm_${data.projectName}`);
                const elementHandle = await page.$(
                    `#${role}_${data.projectName}`
                );
                expect(elementHandle).toEqual(null);
            }
        );
    });

    test('should not allow administrator to add project owners', async () => {
        return await cluster.execute(
            { anotherEmail, anotherPassword, projectName, isParentUser: true },
            async ({ page, data }) => {
                const user = {
                    email: data.anotherEmail,
                    password: data.anotherPassword,
                };
                await page.goto(utils.DASHBOARD_URL);

                await init.loginUser(user, page);
                await init.switchProject(data.projectName, page);

                const role = 'Owner';

                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${data.projectName}`);
                await page.click(`#btn_${data.projectName}`);
                await page.waitForSelector(`#frm_${data.projectName}`);
                const elementHandle = await page.$(
                    `#${role}_${data.projectName}`
                );
                expect(elementHandle).toEqual(null);
            }
        );
    });

    test('should add a new user to sub-project (role -> `Member`)', async done => {
        await cluster.execute(
            {
                email,
                password,
                newEmail,
                subProjectName,
                isParentUser: true,
                projectName,
            },
            async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };
                await page.goto(utils.DASHBOARD_URL);
                await init.loginUser(user, page);
                await init.switchProject(data.projectName, page);

                const role = 'Member';

                await page.waitForSelector('#teamMembers', { visible: true });
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${data.subProjectName}`);
                await page.click(`#btn_${data.subProjectName}`);
                await page.waitForSelector(`#frm_${data.subProjectName}`);
                await page.click(`#emails_${data.subProjectName}`);
                await page.type(
                    `#emails_${data.subProjectName}`,
                    data.newEmail
                );
                await page.click(`#${role}_${data.subProjectName}`);
                await page.waitForSelector(`#btn_modal_${data.subProjectName}`);
                await page.click(`#btn_modal_${data.subProjectName}`);
                await page.waitForSelector(
                    `#btn_modal_${data.subProjectName}`,
                    {
                        hidden: true,
                    }
                );

                await page.waitForSelector(`#count_${data.subProjectName}`);
                const memberCount = await page.$eval(
                    `#count_${data.subProjectName}`,
                    elem => elem.textContent
                );
                expect(memberCount).toEqual('Page 1 of 1 (3 Team Members)');
            }
        );
        done();
    }, 200000);

    test(
        'should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)',
        async done => {
            const newRole = 'Member';
            await cluster.execute(
                { email, password, newRole, anotherEmail, projectName },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };
                    const emailSelector = data.anotherEmail.split('@')[0];

                    await page.goto(utils.DASHBOARD_URL);
                    await init.loginUser(user, page);
                    await init.switchProject(data.projectName, page);
                    await page.waitForSelector('#teamMembers');
                    await page.click('#teamMembers');
                    await page.waitForSelector(`#changeRole_${emailSelector}`);
                    await page.click(`#changeRole_${emailSelector}`);
                    await page.waitForSelector(`div[title="${data.newRole}"]`);
                    await page.click(`div[title="${data.newRole}"]`);

                    const member = await page.waitForSelector(
                        `#${data.newRole}_${emailSelector}`,
                        {
                            visible: true,
                        }
                    );
                    expect(member).toBeDefined();
                }
            );
            done();
        },
        operationTimeOut
    );

    test(
        'should remove user from project Team Members and all sub-projects.',
        async done => {
            await cluster.execute(
                { email, password, anotherEmail, projectName },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };
                    const emailSelector = data.anotherEmail.split('@')[0];

                    await page.goto(utils.DASHBOARD_URL);
                    await init.loginUser(user, page);
                    await page.waitForSelector('#teamMembers');
                    await page.click('#teamMembers');
                    await page.waitForSelector(
                        `#removeMember__${emailSelector}`,
                        { visible: true }
                    );
                    await page.click(`#removeMember__${emailSelector}`);
                    await page.waitForSelector('#removeTeamUser');
                    await page.click('#removeTeamUser');
                    await page.waitForSelector('#removeTeamUser', {
                        hidden: true,
                    });

                    await page.waitForSelector(`#count_${data.projectName}`);
                    const memberCount = await page.$eval(
                        `#count_${data.projectName}`,
                        elem => elem.textContent
                    );
                    expect(memberCount).toEqual('Page 1 of 1 (1 Team Member)');
                }
            );
            done();
        },
        operationTimeOut
    );

    test(
        'should not add team members without business emails',
        async done => {
            await cluster.execute(
                { email, password },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };
                    const role = 'Member';
                    const nonBusinessEmail =
                        utils.generateRandomString() + '@gmail.com';

                    await page.goto(utils.DASHBOARD_URL);
                    await init.loginUser(user, page);
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
                }
            );
            done();
        },
        operationTimeOut
    );
});
