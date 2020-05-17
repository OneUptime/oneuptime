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
        'should show upgrade modal when number of monitor for a project is reached',
        async () => {
            const componentName = utils.generateRandomString();

            await cluster.execute(null, async ({ page }) => {
                // create a component
                await init.addComponent(componentName, page);

                // view the created component
                await page.waitForSelector(`#more-details-${componentName}`);
                await page.click(`#more-details-${componentName}`);

                for (let i = 0; i <= 5; i++) {
                    let monitorName = utils.generateRandomString();

                    await init.addMonitorToComponent(null, monitorName, page);
                    await page.waitForSelector('.ball-beat', { hidden: true });
                }
                
                // try to add more monitor
                const monitorName = utils.generateRandomString();
                await init.addMonitorToComponent(null, monitorName, page);

                const pricingPlanModal = await page.waitForSelector('#pricingPlanModal', {visible: true});
                expect(pricingPlanModal).toBeTruthy();
            });
        },
        operationTimeOut
    );
});
