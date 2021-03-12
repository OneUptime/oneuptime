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

    let cluster, initialTemplate;
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
        'should not show reset button if sms template is not saved yet',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#smsCalls');
                await page.click('#smsCalls');
                await page.waitForSelector('#type');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#templateField');
                initialTemplate = await page.$eval(
                    '#templateField',
                    elem => elem.value
                );
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
        'Should update default sms template',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#smsCalls');
                await page.click('#smsCalls');
                await page.waitForSelector('#type');
                await init.selectByText(
                    '#type',
                    ' External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#frmSmsTemplate');
                const newTemplate = 'New Body';
                await page.click('textarea[name=body]', { clickCount: 3 });
                await page.type('textarea[name=body]', newTemplate);
                await page.click('#saveTemplate');
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                });
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#frmSmsTemplate');

                const smsTemplateBody = await page.$eval(
                    'textarea[name=body]',
                    el => el.value
                );
                expect(smsTemplateBody).toEqual(newTemplate);
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
                await page.waitForSelector('#smsCalls');
                await page.click('#smsCalls');
                await page.waitForSelector('#type');
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
                await page.waitForSelector('#smsCalls');
                await page.click('#smsCalls');
                await page.waitForSelector('#type');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );

                await page.waitForSelector('#templateReset');
                await page.click('#templateReset');
                await page.waitForSelector('#ResetSmsTemplate');
                await page.click('#ResetSmsTemplate');

                await page.waitForSelector('#ResetSmsTemplate', {
                    hidden: true,
                });
                await page.reload();
                await page.waitForSelector('#type');
                await init.selectByText(
                    '#type',
                    'External Subscriber Incident Created',
                    page
                );
                await page.waitForSelector('#templateField');
                const template = await page.$eval(
                    '#templateField',
                    elem => elem.value
                );
                expect(template).toEqual(initialTemplate);
            });

            done();
        },
        operationTimeOut
    );
});
