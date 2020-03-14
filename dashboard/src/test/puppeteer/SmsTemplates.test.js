const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('SMS Templates API', () => {
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
            await init.registerUser(user, page);
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
        'Should update default sms template',
        async done => {
            expect.assertions(1);

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
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#sms');
                await page.click('#sms');
                await page.waitFor(5000);
                await init.selectByText(
                    '#type',
                    'Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#frmSmsTemplate');
                await page.click('textarea[name=body]', { clickCount: 3 });
                await page.type('textarea[name=body]', 'New Body');
                await page.click('button[type=submit]');
                await page.waitFor(10000);

                await page.reload({
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                });
                await page.waitFor(5000);
                await init.selectByText(
                    '#type',
                    'Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#frmSmsTemplate');

                const smsTemplateBody = await page.$eval(
                    'textarea[name=body]',
                    el => el.value
                );
                expect(smsTemplateBody).toEqual('New Body');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
