const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
const subProjectName = utils.generateRandomString();

describe('Monitor API With SubProjects', () => {
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
                // Create component
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

                await init.logout(page);
            }
        };

        await cluster.execute(
            {
                projectName,
                subProjectName,
                email,
                password,
                newEmail,
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
        'should not display new monitor form for user that is not `admin` in sub-project.',
        async () => {
            expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Switch to invited project for new user
                // await init.switchProject(projectName, page); // Commented because project already switched to
                await page.goto(utils.DASHBOARD_URL);
                const newComponentForm = await page.$('#form-new-component');
                expect(newComponentForm).toEqual(null);
                // Navigate to details page of component created
                // await init.navigateToComponentDetails(componentName, page);

                const newMonitorForm = await page.$('#form-new-monitor');
                expect(newMonitorForm).toEqual(null);
            });
        },
        operationTimeOut
    );

    test(
        'should create a monitor in sub-project for valid `admin`',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                const user = { email, password };
                await init.loginUser(user, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                // switch to invited project for new user
                // await page.waitForSelector('#monitors');
                // await page.click('#monitors');
                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', subProjectMonitorName);
                await init.selectByText('#type', 'url', page);
                await init.selectByText('#subProjectId', subProjectName, page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');
                await page.waitFor(5000);
                let spanElement = await page.$(
                    `#monitor-title-${subProjectMonitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).toBe(subProjectMonitorName);
            });
        },
        operationTimeOut
    );

    test(
        'should create a monitor in parent project for valid `admin`',
        async () => {
            expect.assertions(1);
            const monitorName = utils.generateRandomString();
            return await cluster.execute(
                { email, password, monitorName },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // Navigate to details page of component created
                    await init.navigateToComponentDetails(componentName, page);

                    await page.waitForSelector('#form-new-monitor');
                    await page.click('input[id=name]');
                    await page.type('input[id=name]', data.monitorName);
                    await init.selectByText('#type', 'manual', page);
                    await page.click('button[type=submit]');
                    await page.waitFor(5000);
                    let spanElement = await page.$(
                        `#monitor-title-${data.monitorName}`
                    );
                    spanElement = await spanElement.getProperty('innerText');
                    spanElement = await spanElement.jsonValue();
                    expect(spanElement).toBe(data.monitorName);
                }
            );
        },
        operationTimeOut
    );

    test(
        // eslint-disable-next-line quotes
        "should get only sub-project's monitors for valid sub-project user",
        async () => {
            expect.assertions(2);
            return await cluster.execute(
                {
                    email: newEmail,
                    password: newPassword,
                    projectName,
                    subProjectName,
                },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // switch to invited project for new user
                    // await init.switchProject(data.projectName, page); // Commented because project already switched to

                    const projectBadgeSelector = await page.$(
                        `#badge_${data.projectName}`
                    );

                    expect(projectBadgeSelector).toEqual(null);

                    const subProjectBadgeSelector = await page.$(
                        `#badge_${data.subProjectName}`
                    );
                    let textContent = await subProjectBadgeSelector.getProperty(
                        'innerText'
                    );

                    textContent = await textContent.jsonValue();
                    expect(textContent).toEqual(
                        data.subProjectName.toUpperCase()
                    );
                }
            );
        },
        operationTimeOut
    );

    test(
        'should get both project and sub-project monitors for valid parent project user.',
        async () => {
            expect.assertions(2);
            const monitorName = utils.generateRandomString();

            return await cluster.execute(
                {
                    email,
                    password,
                    projectName,
                    subProjectName,
                    monitorName,
                },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    // Navigate to details page of component created
                    await init.navigateToComponentDetails(componentName, page);
                    await page.waitForSelector('#form-new-monitor');
                    await page.click('input[id=name]');
                    await page.type('input[id=name]', data.monitorName);
                    await init.selectByText('#type', 'manual', page);
                    await page.click('button[type=submit]');
                    // create a monitor for subproject
                    await page.waitForSelector('#monitors');
                    await page.click('#monitors');
                    await page.waitForSelector('#form-new-monitor');
                    await page.click('input[id=name]');
                    await page.type('input[id=name]', `${data.monitorName}1`);
                    await init.selectByText('#type', 'manual', page);
                    await init.selectByText(
                        '#subProjectId',
                        data.subProjectName,
                        page
                    );
                    await page.click('button[type=submit]');

                    await page.waitForSelector('#badge_Project');
                    const projectBadgeSelector = await page.$('#badge_Project');
                    let textContent = await projectBadgeSelector.getProperty(
                        'innerText'
                    );

                    textContent = await textContent.jsonValue();
                    expect(textContent).toEqual('PROJECT');

                    const subProjectBadgeSelector = await page.$(
                        `#badge_${subProjectName}`
                    );

                    textContent = await subProjectBadgeSelector.getProperty(
                        'innerText'
                    );
                    textContent = await textContent.jsonValue();
                    expect(textContent).toEqual(subProjectName.toUpperCase());
                }
            );
        },
        operationTimeOut
    );
});
