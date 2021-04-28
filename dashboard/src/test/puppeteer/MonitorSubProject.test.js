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

    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
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

        await cluster.execute(null, async ({ page }) => {
            const user = { email, password };
            await init.loginUser(user, page);
            await init.addGrowthProject(projectName, page);

            // rename default project
            await init.renameProject(projectName, page);
            // add sub-project
            await init.addSubProject(subProjectName, page);
            // Create component
            await init.addComponent(componentName, page, subProjectName);

            await page.goto(utils.DASHBOARD_URL);
            // add new user to sub-project
            await init.addUserToProject(
                {
                    email: newEmail,
                    role: 'Member',
                    subProjectName,
                },
                page
            );
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should not display new monitor form for user that is not `admin` in sub-project.',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                const user = { email: newEmail, password: newPassword };
                await init.loginUser(user, page);
                // Switch to invited project for new user
                // await init.switchProject(subProjectName, page); // Commented because project already switched to
                // await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');
                const newComponentForm = await page.$('#form-new-component');
                expect(newComponentForm).toEqual(null);
                // Navigate to details page of component created
                // await init.navigateToComponentDetails(componentName, page);

                const newMonitorForm = await page.$('#form-new-monitor');
                expect(newMonitorForm).toEqual(null);
                await init.logout(page);
            });

            done();
        },
        operationTimeOut
    );

    test(
        'should create a monitor in sub-project for valid `admin`',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                const user = { email, password };
                await init.loginUser(user, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                // switch to invited project for new user
                await page.waitForSelector('#monitors');
                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', subProjectMonitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', {visible: true});
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');
                await page.waitForSelector(
                    `#monitor-title-${subProjectMonitorName}`,
                    { visible: true }
                );
                let spanElement = await page.$(
                    `#monitor-title-${subProjectMonitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).toBe(subProjectMonitorName);
            });

            done();
        },
        operationTimeOut
    );

    test(
        'should create a monitor in parent project for valid `admin`',
        async done => {
            const monitorName = utils.generateRandomString();
            await cluster.execute(
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
                    await page.click('[data-testId=type_manual]');
                    await page.click('button[type=submit]');
                    await page.waitForSelector(
                        `#monitor-title-${data.monitorName}`,
                        { visible: true, timeout: operationTimeOut }
                    );
                    let spanElement = await page.$(
                        `#monitor-title-${data.monitorName}`
                    );
                    spanElement = await spanElement.getProperty('innerText');
                    spanElement = await spanElement.jsonValue();
                    expect(spanElement).toBe(data.monitorName);
                }
            );

            done();
        },
        operationTimeOut
    );

    test(
        // eslint-disable-next-line quotes
        "should get only sub-project's monitors for valid sub-project user",
        async done => {
            await cluster.execute(
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
                    await page.waitForSelector('#components', {
                        visible: true,
                    });
                    await page.click('#components');

                    const projectBadgeSelector = await page.$(
                        `#badge_${data.projectName}`
                    );

                    expect(projectBadgeSelector).toEqual(null);

                    await page.waitForSelector(
                        `#badge_${data.subProjectName}`,
                        { visible: true }
                    );
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

            done();
        },
        operationTimeOut
    );

    test(
        'should get both project and sub-project monitors for valid parent project user.',
        async done => {
            const monitorName = utils.generateRandomString();

            await cluster.execute(
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
                    await page.click('[data-testId=type_manual]');
                    await page.click('#addMonitorButton');
                    await page.waitForSelector('.ball-beat', { hidden: true });
                    await page.waitForSelector('#cbMonitors', {
                        visible: true,
                    });
                    await page.click('#cbMonitors');
                    await page.waitForSelector('#form-new-monitor', {
                        visible: true,
                    });
                    await page.click('input[id=name]');
                    await page.type('input[id=name]', `${data.monitorName}1`);
                    await page.click('[data-testId=type_manual]');
                    await page.click('#addMonitorButton');
                    await page.waitForSelector('.ball-beat', { hidden: true });
                    await page.waitForSelector('#cbMonitors', {
                        visible: true,
                    });
                    await page.click('#cbMonitors');
                    await page.waitForSelector(`#badge_${subProjectName}`);
                    const subProjectBadgeSelector = await page.$(
                        `#badge_${subProjectName}`
                    );

                    let textContent = await subProjectBadgeSelector.getProperty(
                        'innerText'
                    );
                    textContent = await textContent.jsonValue();
                    expect(textContent.toUpperCase()).toEqual(
                        subProjectName.toUpperCase()
                    );
                }
            );

            done();
        },
        operationTimeOut
    );
});
