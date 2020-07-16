const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const teamEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
const newProjectName = 'Test';
const subProjectName = 'Trial';

describe('Sub-Project API', () => {
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

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show pricing plan modal for project not on Growth plan and above',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#btn_Add_SubProjects');
                await page.click('#btn_Add_SubProjects');

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { visible: true }
                );

                expect(pricingPlanModal).toBeTruthy();
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
                await init.growthPlanUpgrade(page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // adding a subProject is only allowed on growth plan and above
                await init.addSubProject(subProjectName, page);
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
        'should show unauthorised modal to a team member who is not an admin or owner of the project',
        async done => {
            cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
            });

            await cluster.execute(null, async ({ page }) => {
                await init.loginUser({ email: teamEmail, password }, page);
                await init.switchProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('input[name=project_name]');
                const disabled = await page.$eval(
                    'input[name=project_name]',
                    input => input.disabled
                );
                await page.waitForSelector('#btn_Add_SubProjects', {
                    visible: true,
                });
                await page.click('#btn_Add_SubProjects');
                const unauthorisedModal = await page.waitForSelector(
                    '#unauthorisedModal',
                    { visible: true }
                );

                expect(unauthorisedModal).toBeDefined();
                expect(disabled).toBe(true);
            });
            done();
        },
        operationTimeOut
    );
});
