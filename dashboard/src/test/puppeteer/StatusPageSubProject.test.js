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

describe('StatusPage API With SubProjects', () => {
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

            await page.goto(utils.DASHBOARD_URL);

            await page.waitForSelector('#AccountSwitcherId');
            await page.click('#AccountSwitcherId');
            await page.waitForSelector('#create-project');
            await page.click('#create-project');
            await page.waitForSelector('#name');
            await page.type('#name', projectName);
            await page.$$eval(
                'input[name="planId"]',
                inputs => inputs[2].click() // select Growth plan
            );
            await page.click('#btnCreateProject');
            await page.waitForNavigation({ waitUntil: 'networkidle0' });

            // add sub-project
            await init.addSubProject(subProjectName, page);
            // Create Component
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
            // Navigate to details page of component created
            await init.navigateToComponentDetails(componentName, page);
            // add new monitor to sub-project
            await init.addMonitorToSubProject(
                subProjectMonitorName,
                subProjectName,
                componentName,
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
        'should not display create status page button for subproject `member` role.',
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
                    // await init.switchProject(data.projectName, page);
                    await page.waitForSelector('#statusPages');
                    await page.click('#statusPages');

                    const createButton = await page.$(
                        `#btnCreateStatusPage_${data.subProjectName}`
                    );

                    expect(createButton).toBe(null);
                }
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should create a status page in sub-project for sub-project `admin`',
        async done => {
            const statuspageName = utils.generateRandomString();
            await cluster.execute(
                { email, password, subProjectName, statuspageName },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };
                    await init.loginUser(user, page);
                    await init.addStatusPageToProject(
                        data.statuspageName,
                        data.subProjectName,
                        page
                    );
                    await page.waitFor(2000);
                    await page.waitForSelector(
                        `#status_page_count_${data.subProjectName}`
                    );

                    const statusPageCountSelector = await page.$(
                        `#status_page_count_${data.subProjectName}`
                    );
                    let textContent = await statusPageCountSelector.getProperty(
                        'innerText'
                    );

                    textContent = await textContent.jsonValue();
                    expect(textContent).toEqual('1 Status Page');
                }
            );

            done();
        },
        operationTimeOut
    );

    test('should get list of status pages in sub-projects and paginate status pages in sub-project', async done => {
        const fn = async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            await init.loginUser(user, page);
            if (data.isParentUser) {
                // add 10 more statuspages to sub-project to test for pagination
                for (let i = 0; i < 10; i++) {
                    const statuspageName = utils.generateRandomString();
                    await init.addStatusPageToProject(
                        statuspageName,
                        data.subProjectName,
                        page
                    );
                    await page.waitFor(2000);
                }
                await init.logout(page);
            } else {
                // await cluster.waitForOne();
                // // switch to invited project for new user
                // await init.switchProject(data.projectName, page);
                await page.waitForSelector('#statusPages');
                await page.click('#statusPages');

                await page.waitForSelector('tr.statusPageListItem');

                let statusPageRows = await page.$$('tr.statusPageListItem');
                let countStatusPages = statusPageRows.length;

                expect(countStatusPages).toEqual(10);

                const nextSelector = await page.$('#btnNext');

                await nextSelector.click();
                await page.waitFor(5000);
                statusPageRows = await page.$$('tr.statusPageListItem');
                countStatusPages = statusPageRows.length;
                expect(countStatusPages).toEqual(1);

                const prevSelector = await page.$('#btnPrev');

                await prevSelector.click();
                await page.waitFor(5000);
                statusPageRows = await page.$$('tr.statusPageListItem');
                countStatusPages = statusPageRows.length;

                expect(countStatusPages).toEqual(10);
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

        done();
    }, 500000);

    test(
        'should update sub-project status page settings',
        async done => {
            await cluster.execute(
                { email, password, subProjectMonitorName },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    await page.waitForSelector('#statusPages');
                    await page.click('#statusPages');
                    await page.waitForSelector('tr.statusPageListItem');
                    await page.click('tr.statusPageListItem');
                    await page.waitForSelector(`#btnAddStatusPageMonitors`);
                    await page.click('#btnAddStatusPageMonitors');
                    await page.click('#domain');
                    await page.type('#domain', 'https://fyipe.com');
                    await page.click('#btnAddDomain');
                    await page.click('textarea[name=description]');
                    await page.type(
                        'textarea[name=description]',
                        'Statuspage Description'
                    );
                    await page.waitForSelector('#btnAddLink');
                    await page.click('#btnAddLink');
                    await page.waitForSelector('#footerName');
                    await page.click('#footerName');
                    await page.type('#footerName', 'Home');
                    await page.click('#url');
                    await page.type('#url', 'https://fyipe.com');
                    await page.click('#createFooter');
                }
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should delete sub-project status page',
        async done => {
            await cluster.execute(
                {
                    email,
                    password,
                },
                async ({ page, data }) => {
                    await page.setDefaultTimeout(utils.timeout);
                    const user = {
                        email: data.email,
                        password: data.password,
                    };

                    await init.loginUser(user, page);
                    await page.waitForSelector('#statusPages');
                    await page.click('#statusPages');
                    await page.waitForSelector('tr.statusPageListItem');
                    await page.click('tr.statusPageListItem');
                    await page.waitForSelector('#delete');
                    await page.click('#delete');
                    await page.waitForSelector('#confirmDelete');
                    await page.click('#confirmDelete');
                    await page.waitFor(5000);
                    await page.waitForSelector('#statusPages');
                    await page.click('#statusPages');
                    await page.waitFor(5000);

                    const statusPageRows = await page.$$(
                        'tr.statusPageListItem'
                    );
                    const countStatusPages = statusPageRows.length;

                    expect(countStatusPages).toEqual(10);
                }
            );

            done();
        },
        operationTimeOut
    );
});
