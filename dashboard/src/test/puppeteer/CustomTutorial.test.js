const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Custom Tutorial With SubProjects', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should show indicator on how to create component, and after closing, it should not reapprear',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                const customTutorialType = 'component';
                // Navigate to home page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitFor(5000);
                const componentBoxElement = await page.waitForSelector(
                    `#info-${customTutorialType}`
                );
                expect(componentBoxElement).toBeDefined();

                // click on the call to action button
                await page.waitForSelector(`#close-${customTutorialType}`);
                await page.click(`#close-${customTutorialType}`);
            });
        },
        operationTimeOut
    );
    test(
        'Should show indicator on how to create monitor, and after closing, it should not reapprear',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                const customTutorialType = 'monitor';
                // Navigate to home page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitFor(5000);
                const componentBoxElement = await page.waitForSelector(
                    `#info-${customTutorialType}`
                );
                expect(componentBoxElement).toBeDefined();

                // click on the call to action button
                await page.waitForSelector(`#close-${customTutorialType}`);
                await page.click(`#close-${customTutorialType}`);
            });
        },
        operationTimeOut
    );
    test(
        'Should show indicator on how to invite team member, and after closing, it should not reapprear',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.loginUser(user, page);
                const customTutorialType = 'teamMember';
                // Navigate to home page
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitFor(5000);
                const componentBoxElement = await page.waitForSelector(
                    `#info-${customTutorialType}`
                );
                expect(componentBoxElement).toBeDefined();

                // click on the call to action button
                await page.waitForSelector(`#close-${customTutorialType}`);
                await page.click(`#close-${customTutorialType}`);
            });
        },
        operationTimeOut
    );
});
