const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let defaultSubject;

describe('Email Templates API', () => {
    const operationTimeOut = 100000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerUser(user, page);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should not show reset button when no template is saved',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email');
                await page.click('#email');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#name');
                defaultSubject = await page.$eval('#name', elem => elem.value);
                const resetBtn = await page.waitForSelector('#templateReset', {
                    hidden: true,
                });
                expect(resetBtn).toBeNull();
            });

            done();
        },
        operationTimeOut
    );

    test(
        'Should update default email template',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email');
                await page.click('#email');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                const subject = 'Updated Subject';
                await page.waitForSelector('#name');
                await page.click('#name', { clickCount: 3 });
                await page.type('#name', subject);
                await page.click('#saveTemplate');
                await page.waitForSelector('#ball-beat', { hidden: true });

                await page.reload();
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#name');
                const finalSubject = await page.$eval(
                    '#name',
                    elem => elem.value
                );

                expect(finalSubject).toEqual(subject);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should show reset button when a template is already saved',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email');
                await page.click('#email');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                const resetBtn = await page.waitForSelector('#templateReset', {
                    visible: true,
                });
                expect(resetBtn).toBeDefined();
            });

            done();
        },
        operationTimeOut
    );

    test(
        'should reset template to default state',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email');
                await page.click('#email');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#templateReset', {
                    visible: true,
                });
                await page.click('#templateReset');
                await page.waitForSelector('#ball-beat', { hidden: true });

                await page.reload();
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#name');
                const finalSubject = await page.$eval(
                    '#name',
                    elem => elem.value
                );
                expect(defaultSubject).toEqual(finalSubject);
            });

            done();
        },
        operationTimeOut
    );
});
