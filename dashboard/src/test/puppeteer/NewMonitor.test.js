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
        async done => {
            const componentName = utils.generateRandomString();

            await cluster.execute(null, async ({ page }) => {
                // create a component
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                for (let i = 0; i < 5; i++) {
                    const monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(
                        null,
                        monitorName,
                        page,
                        componentName
                    );
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }

                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');
                await page.waitForSelector('#component0', { visible: true });
                await page.click(`#more-details-${componentName}`);

                await page.waitForSelector('input[id=name]');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                //Please add a new monitor type here. IOT Device Monitor has been removed.
                await page.click('button[type=submit]');

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { visible: true }
                );
                expect(pricingPlanModal).toBeTruthy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Growth plan => 10 Monitors/User)",
        async done => {
            const projectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            await cluster.execute(null, async ({ page }) => {
                await init.addGrowthProject(projectName, page);

                // create a component
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                for (let i = 0; i < 10; i++) {
                    const monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(
                        null,
                        monitorName,
                        page,
                        componentName
                    );
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }

                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');
                await page.waitForSelector('#component0', { visible: true });
                await page.click(`#more-details-${componentName}`);

                await page.waitForSelector('input[id=name]');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                //Please add a new monitor type here. IOT Device Monitor has been removed.
                await page.click('button[type=submit]');

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { visible: true }
                );
                expect(pricingPlanModal).toBeTruthy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not show any upgrade modal if the project plan is on Scale plan and above',
        async done => {
            const projectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            await cluster.execute(null, async ({ page }) => {
                await init.addScaleProject(projectName, page);

                // create a component
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                for (let i = 0; i < 15; i++) {
                    const monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(
                        null,
                        monitorName,
                        page,
                        componentName
                    );
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }

                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await init.addMonitorToComponent(
                    null,
                    monitorName,
                    page,
                    componentName
                );

                const pricingPlanModal = await page.waitForSelector(
                    '#pricingPlanModal',
                    { hidden: true }
                );
                expect(pricingPlanModal).toBeNull();
            });
            done();
        },
        operationTimeOut
    );
});
