const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const teamEmail = utils.generateRandomBusinessEmail();
const newProjectName = 'Test';
const subProjectName = 'Trial';

describe('Project Setting: Change Plan', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });

        cluster.on('error', err => {
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
        'should change project plan',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await init.growthPlanUpgrade(page);
                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('input#Growth_month');
                const checked = await page.$eval(
                    'input#Growth_month',
                    input => input.checked
                );
                expect(checked).toBe(true);
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
        'should show unauthorised modal when a team member who is not an admin or owner of the project tries to update alert option',
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
                await page.waitForSelector('#billing');
                await page.click('#billing');
                await page.waitForSelector('#alertEnable', { visible: true });
                await page.$eval('#alertEnable', checkbox => checkbox.click);
                await page.click('#alertOptionSave');
                const unauthorisedModal = await page.waitForSelector(
                    '#unauthorisedModal',
                    { visible: true }
                );
                expect(unauthorisedModal).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );
});
