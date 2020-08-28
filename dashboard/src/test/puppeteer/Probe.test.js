const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('API test', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

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
        return await cluster.execute(null, async ({ page }) => {
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should open the probes details modal if probe is offline',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#probe');
                await page.click('#probe a');
                await page.waitFor(5000);
                await page.waitForSelector('#probe_0');
                const elementHandle = await page.$('#offline_0 > span > span');
                const modalTitle = await page.$(
                    'div.bs-Modal-header-copy > span > span'
                );
                await page.click('#probe_0');
                if (elementHandle) {
                    // Probe is offline
                    expect(modalTitle).toBeDefined();
                } else {
                    // Probe is online
                    expect(modalTitle).toBeNull();
                }
            });
        },
        operationTimeOut
    );
});
