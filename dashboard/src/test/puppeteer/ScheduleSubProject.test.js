const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('Schedule API With SubProjects', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async () => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            maxConcurrency: 2,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        const task = async ({ page, data }) => {
            await page.setDefaultTimeout(utils.timeout);
            const user = {
                email: data.email,
                password: data.password,
            };

            // user
            await init.registerUser(user, page, data.isParentUser);
            await init.loginUser(user, page);

            if (data.isParentUser) {
                // rename default project
                await init.renameProject(data.projectName, page);
                // add sub-project
                await init.addSubProject(data.subProjectName, page);
                // Create Component
                await init.addComponent(
                    componentName,
                    page,
                    data.subProjectName
                );
                // add new user to sub-project
                await init.addUserToProject(
                    {
                        email: data.newEmail,
                        role: 'Member',
                        subProjectName: data.subProjectName,
                    },
                    page
                );
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                // add new monitor to sub-project
                await init.addMonitorToSubProject(
                    data.subProjectMonitorName,
                    data.subProjectName,
                    componentName,
                    page
                );
            }
        };

        await cluster.execute(
            {
                projectName,
                subProjectName,
                email,
                password,
                newEmail,
                subProjectMonitorName,
                isParentUser: true,
            },
            task
        );

        await cluster.execute(
            {
                projectName,
                subProjectName,
                email: newEmail,
                password: newPassword,
                isParentUser: false,
            },
            task
        );
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should not display create schedule button for subproject `member` role.',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                {
                    email: newEmail,
                    password: newPassword,
                    projectName,
                    subProjectName,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // switch to invited project for new user
                    // await init.switchProject(data.projectName, page);

                    await page.waitForSelector('#callSchedules');
                    await page.click('#callSchedules');

                    const createButton = await page.$(
                        `#btnCreateSchedule_${data.subProjectName}`
                    );

                    expect(createButton).toBe(null);
                }
            );
        },
        operationTimeOut
    );

    test(
        'should create a schedule in sub-project for sub-project `admin`',
        async () => {
            expect.assertions(1);
            const scheduleName = utils.generateRandomString();

            return await cluster.execute(
                { email, password, subProjectName, scheduleName },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    await init.addScheduleToProject(
                        data.scheduleName,
                        data.subProjectName,
                        page
                    );
                    await page.waitFor(2000);
                    await page.waitForSelector(
                        `#schedule_count_${data.subProjectName}`
                    );

                    const scheduleCountSelector = await page.$(
                        `#schedule_count_${data.subProjectName}`
                    );
                    let textContent = await scheduleCountSelector.getProperty(
                        'innerText'
                    );

                    textContent = await textContent.jsonValue();
                    expect(textContent).toEqual('1 schedule');
                }
            );
        },
        operationTimeOut
    );

    test('should get list schedules in sub-projects and paginate schedules in sub-project', async () => {
        expect.assertions(3);
        const fn = async ({ page, data }) => {
            await page.setDefaultTimeout(utils.timeout);
            const user = {
                email: data.email,
                password: data.password,
            };

            await init.loginUser(user, page);
            if (data.isParentUser) {
                // add 10 more schedules to sub-project to test for pagination
                for (let i = 0; i < 10; i++) {
                    const scheduleName = utils.generateRandomString();
                    await init.addScheduleToProject(
                        scheduleName,
                        data.subProjectName,
                        page
                    );
                    await page.waitFor(1000);
                }
            } else {
                // await cluster.waitForOne();
                // // switch to invited project for new user
                // await init.switchProject(data.projectName, page);
                await page.waitForSelector('#callSchedules');
                await page.click('#callSchedules');
                await page.waitFor(3000);

                let scheduleRows = await page.$$('tr.scheduleListItem');
                let countSchedules = scheduleRows.length;

                expect(countSchedules).toEqual(10);

                const nextSelector = await page.$('#btnNext');

                await nextSelector.click();
                await page.waitFor(5000);
                scheduleRows = await page.$$('tr.scheduleListItem');
                countSchedules = scheduleRows.length;
                expect(countSchedules).toEqual(1);

                const prevSelector = await page.$('#btnPrev');

                await prevSelector.click();
                await page.waitFor(5000);
                scheduleRows = await page.$$('tr.scheduleListItem');
                countSchedules = scheduleRows.length;
                expect(countSchedules).toEqual(10);
            }
        };

        await cluster.execute(
            { email, password, subProjectName, isParentUser: true },
            fn
        );
        await cluster.execute(
            {
                email: newEmail,
                password: newPassword,
                projectName,
                isParentUser: false,
            },
            fn
        );
    }, 200000);

    test(
        'should add monitor to sub-project schedule',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                {
                    email,
                    password,
                    projectName,
                    subProjectMonitorName,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    await page.waitForSelector('#callSchedules');
                    await page.click('#callSchedules');
                    await page.waitForSelector('tr.scheduleListItem');
                    await page.click('tr.scheduleListItem');
                    await page.waitForSelector(
                        `span[title="${data.subProjectMonitorName}"]`
                    );
                    await page.click(
                        `span[title="${data.subProjectMonitorName}"]`
                    );
                    await page.waitForSelector('#btnSaveMonitors');
                    await page.click('#btnSaveMonitors');
                    await page.waitFor(5000);

                    const monitorSelectValue = await page.$eval(
                        'input[type=checkbox]',
                        el => el.value
                    );

                    expect(monitorSelectValue).toBe('true');
                }
            );
        },
        operationTimeOut
    );

    test(
        'should delete sub-project schedule',
        async () => {
            expect.assertions(1);
            return await cluster.execute(
                {
                    email,
                    password,
                    projectName,
                    subProjectMonitorName,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    await page.waitForSelector('#callSchedules');
                    await page.click('#callSchedules');
                    await page.waitForSelector('tr.scheduleListItem');
                    await page.click('tr.scheduleListItem');
                    await page.waitForSelector('#delete');
                    await page.click('#delete');
                    await page.waitForSelector('#confirmDelete');
                    await page.click('#confirmDelete');
                    await page.waitFor(2000);

                    await page.waitForSelector('#callSchedules');
                    await page.click('#callSchedules');
                    await page.waitForSelector('tr.scheduleListItem');

                    const scheduleRows = await page.$$('tr.scheduleListItem');
                    const countSchedules = scheduleRows.length;

                    expect(countSchedules).toEqual(10);
                }
            );
        },
        operationTimeOut
    );
});
