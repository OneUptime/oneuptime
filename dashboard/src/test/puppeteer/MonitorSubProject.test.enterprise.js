const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Enterprise Monitor SubProject API', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerEnterpriseUser(user, page);
        });

        await cluster.queue({ email, password });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async done => {
        done();
    });

    test(
        'Should create a monitor in sub-project for valid `admin`',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: utils.timeout,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            const subProjectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            const subProjectMonitorName = utils.generateRandomString();

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                // add sub-project
                await init.addSubProject(data.subProjectName, page);

                // Create Component first
                await init.addComponent(data.componentName, page);
                // Navigate to details page of component created
                await init.navigateToComponentDetails(data.componentName, page);

                // switch to invited project for new user
                // await page.waitForSelector('#monitors');
                // await page.click('#monitors');
                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', data.subProjectMonitorName);
                await init.selectByText('#type', 'url', page);
                await init.selectByText(
                    '#subProjectId',
                    data.subProjectName,
                    page
                );
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');
                await page.waitFor(5000);

                let spanElement = await page.$(
                    `#monitor-title-${data.subProjectMonitorName}`
                );

                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).toBe(data.subProjectMonitorName);
            });

            cluster.queue({
                email,
                password,
                subProjectName,
                componentName,
                subProjectMonitorName,
            });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
