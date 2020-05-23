const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('New Monitor API', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async () => {
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
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Startup plan => 5 Monitors/User)",
        async () => {
            const componentName = utils.generateRandomString();

            await cluster.execute(null, async ({ page }) => {
                // create a component
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                for (let i = 0; i <= 5; i++) {
                    const monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(null, monitorName, page);
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }

                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await init.addMonitorToComponent(null, monitorName, page);

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { visible: true }
                );
                expect(pricingPlanModal).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Growth plan => 10 Monitors/User)",
        async () => {
            const projectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#create-project');
                await page.click('#create-project');
                await page.waitForSelector('#name');
                await page.type('#name', projectName);
                await page.$$eval(
                    'input[name="planId"]',
                    inputs => inputs[2].click() // select the Growth plan
                );
                await page.click('#btnCreateProject');
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                // create a component
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                for (let i = 0; i <= 10; i++) {
                    const monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(null, monitorName, page);
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }

                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await init.addMonitorToComponent(null, monitorName, page);

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { visible: true }
                );
                expect(pricingPlanModal).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should not show any upgrade modal if the project plan is on Scale plan and above',
        async () => {
            const projectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#create-project');
                await page.click('#create-project');
                await page.waitForSelector('#name');
                await page.type('#name', projectName);
                await page.$$eval(
                    'input[name="planId"]',
                    inputs => inputs[4].click() // select the Scale plan
                );
                await page.click('#btnCreateProject');
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                // create a component
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                for (let i = 0; i <= 15; i++) {
                    const monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(null, monitorName, page);
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }

                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await init.addMonitorToComponent(null, monitorName, page);

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { hidden: true }
                );
                expect(pricingPlanModal).toBeNull();
            });
        },
        operationTimeOut
    );
});
