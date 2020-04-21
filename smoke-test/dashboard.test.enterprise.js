const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Enterprise Dashboard API', () => {
    const operationTimeOut = 100000;

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

    const componentName = utils.generateRandomString();

    it(
        'Should create new monitor with correct details',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            const monitorName = utils.generateRandomString();

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                // Navigate to Components page
                await page.waitForSelector('#components');
                await page.click('#components');

                // Fill and submit New Component form
                await page.waitForSelector('#form-new-component');
                await page.click('input[id=name]');
                await page.type('input[id=name]', data.componentName);
                await page.click('button[type=submit]');

                // Navigate to details page of component created
                await page.waitForSelector(
                    `#more-details-${data.componentName}`
                );
                await page.click(`#more-details-${data.componentName}`);
                await page.waitForSelector('#form-new-monitor');

                // Fill and submit New Monitor form
                await page.click('input[id=name]');
                await page.type('input[id=name]', data.monitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement;
                spanElement = await page.waitForSelector(
                    `#monitor-title-${data.monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(data.monitorName);
            });

            cluster.queue({ email, password, componentName, monitorName });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    it(
        'Should not create new monitor when details are incorrect',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                // Navigate to Components page
                await page.waitForSelector('#components');
                await page.click('#components');

                // Navigate to details page of component created in previous test
                await page.waitForSelector(
                    `#more-details-${data.componentName}`
                );
                await page.click(`#more-details-${data.componentName}`);
                await page.waitForSelector('#form-new-monitor');

                // Fill and submit New Monitor form
                await page.click('input[id=name]');
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement;
                spanElement = await page.$('#field-error');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'This field cannot be left blank'
                );
            });

            cluster.queue({ email, password, componentName });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
