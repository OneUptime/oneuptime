const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('User Feedback', () => {
    const operationTimeOut = 50000;

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
            await init.registerUser(user, page);
            await init.loginUser(user, page);
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
        'should send feedback in project',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });
            const testFeedback = 'test feedback';

            cluster.on('taskerror', err => {
                throw err;
            });

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);
                await page.waitForSelector('#feedback-div');
                await page.click('#feedback-div', { clickCount: 2 });
                await page.type('#feedback-textarea', data.testFeedback);
                await page.click('#feedback-button');
                await page.waitFor(3000);

                const feedbackMessage = await page.$eval(
                    '#feedback-div',
                    el => el.textContent
                );

                expect(feedbackMessage).toEqual('Thank you for your feedback.');
            });

            cluster.queue({ email, password, testFeedback });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
