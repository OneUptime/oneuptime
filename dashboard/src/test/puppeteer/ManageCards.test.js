const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Stripe cards API', () => {
    const operationTimeOut = 60000;

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
        'should add a valid card',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 60000,
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
                await page.waitForSelector('#projectSettings');
                await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
                await page.waitForSelector('#addCardButton');
                await page.click('#addCardButton');
                await page.waitFor(3000);
                await page.waitForSelector(
                    'iframe[name=__privateStripeFrame5]'
                );

                let frame = await page.$('iframe[name=__privateStripeFrame5]');

                frame = await frame.contentFrame();
                frame.waitForSelector('input[name=cardnumber]');
                await frame.type('input[name=cardnumber]', '6011111111111117', {
                    delay: 50,
                });
                frame.waitForSelector('input[name=exp-date]');
                await frame.type('input[name=exp-date]', '1123');
                frame.waitForSelector('input[name=cvc]');
                await frame.type('input[name=cvc]', '100');
                frame.waitForSelector('input[name=postal]');
                await frame.type('input[name=postal]', '11234');
                await page.click('#addCardButtonSubmit');
                await page.waitFor(20000);

                const cardsCount = await page.$eval(
                    '#cardsCount',
                    el => el.textContent
                );

                expect(cardsCount).toEqual('2 Cards');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete card',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 50000,
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
                await page.waitForSelector('#projectSettings');
                await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
                await page.waitForSelector('#deleteCard1');
                await page.click('#deleteCard1');
                await page.waitForSelector('#deleteCardButton');
                await page.click('#deleteCardButton');
                await page.waitFor(4000);

                const cardsCount = await page.$eval(
                    '#cardsCount',
                    el => el.textContent
                );

                expect(cardsCount).toEqual('1 Card');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test(
        'should not delete card when there is only one card left',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 50000,
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
                await page.waitForSelector('#projectSettings');
                await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
                await page.waitForSelector('#deleteCard0');
                await page.click('#deleteCard0');
                await page.waitForSelector('#deleteCardButton');
                await page.click('#deleteCardButton');
                await page.waitFor(4000);
                await page.click('#deleteCardCancel');

                const cardsCount = await page.$eval(
                    '#cardsCount',
                    el => el.textContent
                );

                expect(cardsCount).toEqual('1 Card');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add an invalid card',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 50000,
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
                await page.waitForSelector('#projectSettings');
                await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
                await page.waitForSelector('#addCardButton');
                await page.click('#addCardButton');
                await page.waitFor(2000);
                await page.waitForSelector(
                    'iframe[name=__privateStripeFrame5]'
                );

                let frame = await page.$('iframe[name=__privateStripeFrame5]');

                frame = await frame.contentFrame();
                frame.waitForSelector('input[name=cardnumber]');
                await frame.type('input[name=cardnumber]', '4242424242424241', {
                    delay: 20,
                });
                frame.waitForSelector('input[name=exp-date]');
                await frame.type('input[name=exp-date]', '1123');
                frame.waitForSelector('input[name=cvc]');
                await frame.type('input[name=cvc]', '100');
                frame.waitForSelector('input[name=postal]');
                await frame.type('input[name=postal]', '11234');
                await page.click('#addCardButtonSubmit');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
