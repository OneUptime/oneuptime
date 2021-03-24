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
const resourceCategory = 'stat';

describe('Resource Category', () => {
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
            //await init.loginUser(user, page);
            // Create Component first
            await init.addComponent(componentName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create a new resource category',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');

                await page.waitForSelector('li#resources a');
                await page.click('li#resources a');
                await page.waitForSelector('#createResourceCategoryButton');
                await page.click('#createResourceCategoryButton');
                await page.type(
                    '#resourceCategoryName',
                    utils.resourceCategoryName
                );
                await page.click('#addResourceCategoryButton');

                const createdResourceCategorySelector =
                    '#resourceCategoryList #resource-category-name:nth-child(2)';

                await page.waitForSelector(createdResourceCategorySelector);

                const createdResourceCategoryName = await page.$eval(
                    createdResourceCategorySelector,
                    el => el.textContent
                );

                expect(createdResourceCategoryName).toEqual(
                    utils.resourceCategoryName
                );
            });
        },
        operationTimeOut
    );

    test(
        'should show created resource category in new monitor dropdown',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#form-new-monitor');

                let resourceCategoryCheck = false;

                await init.selectByText(
                    '#resourceCategory',
                    utils.resourceCategoryName,
                    page
                );

                const noOption = await page.$('div.css-1gl4k7y');

                if (!noOption) {
                    resourceCategoryCheck = true;
                }
                expect(resourceCategoryCheck).toEqual(true);
            });
        },
        operationTimeOut
    );

    test(
        'should create a new monitor by selecting resource category from dropdown',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', utils.monitorName);
                await init.selectByText(
                    '#resourceCategory',
                    utils.resourceCategoryName,
                    page
                );
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await Promise.all([
                    page.click('button[type=submit]'),
                    page.waitForNavigation(),
                ]);

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
        'should delete the created resource category',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');

                await page.waitForSelector('li#resources a');
                await page.click('li#resources a');

                const deleteButtonSelector =
                    `button#delete_${utils.resourceCategoryName}`;
                console.log(utils.resourceCategoryName);
                await page.waitForSelector(deleteButtonSelector);
                await page.click(deleteButtonSelector);
                await page.waitForSelector('#deleteResourceCategory');
                await page.click('#deleteResourceCategory');
                await page.waitForTimeout(5000);

                const resourceCategoryCounterSelector =
                    '#resourceCategoryCount';
                const resourceCategoryCount = await page.$eval(
                    resourceCategoryCounterSelector,
                    el => el.textContent
                );

                expect(resourceCategoryCount).toEqual('0 Resource Category');
            });
        },
        operationTimeOut
    );
});

// describe('Member Restriction', () => {
//     const operationTimeOut = 50000;

//     let cluster;

//     beforeAll(async done => {
//         jest.setTimeout(200000);

//         cluster = await Cluster.launch({
//             concurrency: Cluster.CONCURRENCY_PAGE,
//             puppeteerOptions: utils.puppeteerLaunchConfig,
//             puppeteer,
//             timeout: 120000,
//         });

//         cluster.on('taskerror', err => {
//             throw err;
//         });

//         await cluster.execute(
//             { teamEmail, password },
//             async ({ page, data }) => {
//                 const user = {
//                     email: data.teamEmail,
//                     password: data.password,
//                 };

//                 // user
//                 await init.registerUser(user, page);
//                 await init.loginUser({ email, password }, page);
//                 await init.renameProject(newProjectName, page);
//                 await init.addUserToProject(
//                     {
//                         email: teamEmail,
//                         role: 'Member',
//                         subProjectName: newProjectName,
//                     },
//                     page
//                 );
//                 await init.addResourceCategory(resourceCategory, page);
//                 await init.logout(page);
//             }
//         );

//         done();
//     });

//     afterAll(async done => {
//         await cluster.idle();
//         await cluster.close();
//         done();
//     });

//     test(
//         'should show unauthorised modal when trying to add a resource category for a member who is not the admin or owner of the project',
//         async done => {
//             await cluster.execute(null, async ({ page }) => {
//                 await init.loginUser({ email: teamEmail, password }, page);
//                 await init.switchProject(newProjectName, page);
//                 await page.goto(utils.DASHBOARD_URL);
//                 await page.waitForSelector('#projectSettings', {
//                     visible: true,
//                 });
//                 await page.click('#projectSettings');

//                 await page.waitForSelector('#resources');
//                 await page.click('#resources');
//                 await page.waitForSelector('#createResourceCategoryButton', {
//                     visible: true,
//                 });
//                 await page.click('#createResourceCategoryButton');
//                 const modal = await page.waitForSelector('#unauthorisedModal');
//                 expect(modal).toBeDefined();
//                 await init.logout(page);
//             });
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should show unauthorised modal when trying to edit a resource category for a member who is not the admin or owner of the project',
//         async done => {
//             await cluster.execute(null, async ({ page }) => {
//                 await init.loginUser({ email: teamEmail, password }, page);
//                 await init.switchProject(newProjectName, page);
//                 await page.goto(utils.DASHBOARD_URL);
//                 await page.waitForSelector('#projectSettings', {
//                     visible: true,
//                 });
//                 await page.click('#projectSettings');

//                 await page.waitForSelector('#resources');
//                 await page.click('#resources');
//                 const editBtn = `#edit_${resourceCategory}`;
//                 await page.waitForSelector(editBtn, {
//                     visible: true,
//                 });
//                 await page.click(editBtn);
//                 const modal = await page.waitForSelector('#unauthorisedModal');
//                 expect(modal).toBeDefined();
//                 await init.logout(page);
//             });
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should show unauthorised modal when trying to delete a resource category for a member who is not the admin or owner of the project',
//         async done => {
//             await cluster.execute(null, async ({ page }) => {
//                 await init.loginUser({ email: teamEmail, password }, page);
//                 await init.switchProject(newProjectName, page);
//                 await page.goto(utils.DASHBOARD_URL);
//                 await page.waitForSelector('#projectSettings', {
//                     visible: true,
//                 });
//                 await page.click('#projectSettings');

//                 await page.waitForSelector('#resources');
//                 await page.click('#resources');
//                 const deleteBtn = `#delete_${resourceCategory}`;
//                 await page.waitForSelector(deleteBtn, {
//                     visible: true,
//                 });
//                 await page.click(deleteBtn);
//                 const modal = await page.waitForSelector('#unauthorisedModal');
//                 expect(modal).toBeDefined();
//             });
//             done();
//         },
//         operationTimeOut
//     );
// });
