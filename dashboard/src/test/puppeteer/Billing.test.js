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
    test(
        'should not update project account when admin recharge account with negative number',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                const balance = 0;
                let creditedBalance = 0;
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing');

                // get current balance as $0
                let spanBalanceElement = await page.waitForSelector(
                    '#currentBalance'
                );
                spanBalanceElement = await spanBalanceElement.getProperty(
                    'innerText'
                );
                spanBalanceElement = await spanBalanceElement.jsonValue();
                expect(spanBalanceElement).toMatch(`${balance}$`);

                // add $20 to the account then click cancel
                await page.waitForSelector('#rechargeBalanceAmount');
                await page.click('#rechargeBalanceAmount');
                creditedBalance = -20;
                await page.type(
                    '#rechargeBalanceAmount',
                    creditedBalance.toString()
                );
                await page.click('#rechargeAccount');

                // confirm the current balance is still $0
                spanBalanceElement = await page.waitForSelector('#field-error');
                spanBalanceElement = await spanBalanceElement.getProperty(
                    'innerText'
                );
                spanBalanceElement = await spanBalanceElement.jsonValue();
                expect(spanBalanceElement).toMatch(
                    `Enter a valid number greater than 0`
                );
            });
            done();
        },
        operationTimeOut
    );
    test(
        'should update project account when admin recharge account',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                let balance = 0,
                    creditedBalance = 0;
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing');

                // get current balance as $0
                let spanBalanceElement = await page.waitForSelector(
                    '#currentBalance'
                );
                spanBalanceElement = await spanBalanceElement.getProperty(
                    'innerText'
                );
                spanBalanceElement = await spanBalanceElement.jsonValue();
                expect(spanBalanceElement).toMatch(`${balance}$`);

                // add $20 to the account
                await page.waitForSelector('#rechargeBalanceAmount');
                await page.click('#rechargeBalanceAmount');
                creditedBalance = 20;
                await page.type(
                    '#rechargeBalanceAmount',
                    creditedBalance.toString()
                );
                await page.click('#rechargeAccount');
                balance += creditedBalance;

                await page.waitForSelector('#confirmBalanceTopUp');
                await page.click('#confirmBalanceTopUp');
                await page.waitForTimeout(9000);

                // confirm a pop up comes up and the message is a successful
                let spanModalElement = await page.waitForSelector(
                    '#message-modal-message'
                );
                spanModalElement = await spanModalElement.getProperty(
                    'innerText'
                );
                spanModalElement = await spanModalElement.jsonValue();
                expect(spanModalElement).toMatch(
                    `Transaction successful, your balance is now ${balance}$`
                );

                // click ok
                await page.waitForSelector('#modal-ok');
                await page.click('#modal-ok');
                await page.waitForTimeout(5000);

                // confirm the current balance is $20
                spanBalanceElement = await page.waitForSelector(
                    '#currentBalance'
                );
                spanBalanceElement = await spanBalanceElement.getProperty(
                    'innerText'
                );
                spanBalanceElement = await spanBalanceElement.jsonValue();
                expect(spanBalanceElement).toMatch(`${balance}$`);
            });
            done();
        },
        operationTimeOut
    );
    test(
        'should not update project account when admin recharge account and clicks cancel',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                const balance = 0;
                let creditedBalance = 0;
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing');

                // get current balance as $0
                let spanBalanceElement = await page.waitForSelector(
                    '#currentBalance'
                );
                spanBalanceElement = await spanBalanceElement.getProperty(
                    'innerText'
                );
                spanBalanceElement = await spanBalanceElement.jsonValue();
                expect(spanBalanceElement).toMatch(`${balance}$`);

                // add $20 to the account then click cancel
                await page.waitForSelector('#rechargeBalanceAmount');
                await page.click('#rechargeBalanceAmount');
                creditedBalance = 20;
                await page.type(
                    '#rechargeBalanceAmount',
                    creditedBalance.toString()
                );
                await page.click('#rechargeAccount');

                await page.waitForSelector('#confirmBalanceTopUp');
                await page.click('#cancelBalanceTopUp');
                await page.waitForTimeout(4000);

                // confirm the current balance is still $0
                spanBalanceElement = await page.waitForSelector(
                    '#currentBalance'
                );
                spanBalanceElement = await spanBalanceElement.getProperty(
                    'innerText'
                );
                spanBalanceElement = await spanBalanceElement.jsonValue();
                expect(spanBalanceElement).toMatch(`${balance}$`);
            });
            done();
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

    test(
        'should show unauthorised modal when a team member who is not an admin or owner of the project tries to recharge account',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing');
                await page.waitForSelector('#rechargeBalanceAmount');
                await page.click('#rechargeBalanceAmount');
                await page.type('#rechargeBalanceAmount', '20');
                await page.click('#rechargeAccount');
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

    test(
        'should show unauthorised modal when a team member who is not an admin or owner of the project tries to change project plan',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing');
                await page.waitForSelector('input#Startup_month', {
                    visible: true,
                });
                await page.click('input#Startup_month');
                await page.click('#changePlanBtn');
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