const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const teamEmail = utils.generateRandomBusinessEmail();
const newProjectName = 'Test';
const monitorCategory = 'stat';

describe('Monitor Category', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(async ({ page }) => {
            const user = {
                email,
                password,
            };

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            // Create Component first
            await init.addComponent(componentName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create a new monitor category',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');

                await page.waitForSelector('#monitors a');
                await page.click('#monitors a');
                await page.waitForSelector('#createMonitorCategoryButton');
                await page.click('#createMonitorCategoryButton');
                await page.type(
                    '#monitorCategoryName',
                    utils.monitorCategoryName
                );
                await page.click('#addMonitorCategoryButton');
                await page.waitForSelector('#addMonitorCategoryButton', {
                    hidden: true,
                });

                const createdMonitorCategorySelector = `#monitorCategoryList #monitor-category-${utils.monitorCategoryName}`;
                await page.waitForSelector(createdMonitorCategorySelector);

                const createdMonitorCategoryName = await page.$eval(
                    createdMonitorCategorySelector,
                    el => el.textContent
                );

                expect(createdMonitorCategoryName).toEqual(
                    utils.monitorCategoryName
                );
            });
        },
        operationTimeOut
    );

    test(
        'should show created monitor category in new monitor dropdown',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#form-new-monitor');

                let monitorCategoryCheck = false;

                await init.selectByText(
                    '#monitorCategory',
                    utils.monitorCategoryName,
                    page
                );

                const noOption = await page.$('div.css-1gl4k7y');

                if (!noOption) {
                    monitorCategoryCheck = true;
                }
                expect(monitorCategoryCheck).toEqual(true);
            });
        },
        operationTimeOut
    );

    test(
        'should create a new monitor by selecting monitor category from dropdown',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', utils.monitorName);
                await init.selectByText(
                    '#monitorCategory',
                    utils.monitorCategoryName,
                    page
                );
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                const createdMonitorSelector = `#monitor-title-${utils.monitorName}`;
                await page.waitForSelector(createdMonitorSelector, {
                    visible: true,
                    timeout: operationTimeOut,
                });
                const createdMonitorName = await page.$eval(
                    createdMonitorSelector,
                    el => el.textContent
                );

                expect(createdMonitorName).toEqual(utils.monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'should delete the created monitor category',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');

                await page.waitForSelector('li#monitors a');
                await page.click('li#monitors a');

                const deleteButtonSelector = `#deleteMonitorCategoryBtn #delete_${utils.monitorCategoryName}`;

                await page.waitForSelector(deleteButtonSelector);
                await page.click(deleteButtonSelector);
                await page.waitForSelector('#deleteMonitorCategory');
                await page.click('#deleteMonitorCategory');
                await page.waitForSelector('#deleteMonitorCategory', {
                    hidden: true,
                });
                await page.reload({ waitUntil: 'networkidle0' });

                const monitorCategoryCounterSelector = '#monitorCategoryCount';
                await page.waitForSelector(monitorCategoryCounterSelector);
                const monitorCategoryCount = await page.$eval(
                    monitorCategoryCounterSelector,
                    el => el.textContent
                );

                expect(monitorCategoryCount).toEqual('0 Monitor Category');
            });
        },
        operationTimeOut
    );
});

describe('Member Restriction', () => {
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
                    email: data.teamEmail,
                    password: data.password,
                };

                // user
                await init.registerUser(user, page);
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
                await init.addMonitorCategory(monitorCategory, page);
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
        'should show unauthorised modal when trying to add a monitor category for a member who is not the admin or owner of the project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.loginUser({ email: teamEmail, password }, page);
                await init.switchProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');

                await page.waitForSelector('#monitors');
                await page.click('#monitors');
                await page.waitForSelector('#createMonitorCategoryButton', {
                    visible: true,
                });
                await page.click('#createMonitorCategoryButton');
                const modal = await page.waitForSelector('#unauthorisedModal');
                expect(modal).toBeDefined();
                await init.logout(page);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should show unauthorised modal when trying to edit a monitor category for a member who is not the admin or owner of the project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.loginUser({ email: teamEmail, password }, page);
                await init.switchProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');

                await page.waitForSelector('#monitors');
                await page.click('#monitors');
                const editBtn = `#edit_${monitorCategory}`;
                await page.waitForSelector(editBtn, {
                    visible: true,
                });
                await page.click(editBtn);
                const modal = await page.waitForSelector('#unauthorisedModal');
                expect(modal).toBeDefined();
                await init.logout(page);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should show unauthorised modal when trying to delete a monitor category for a member who is not the admin or owner of the project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.loginUser({ email: teamEmail, password }, page);
                await init.switchProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');

                await page.waitForSelector('#monitors');
                await page.click('#monitors');
                const deleteBtn = `#delete_${monitorCategory}`;
                await page.waitForSelector(deleteBtn, {
                    visible: true,
                });
                await page.click(deleteBtn);
                const modal = await page.waitForSelector('#unauthorisedModal');
                expect(modal).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );
});
