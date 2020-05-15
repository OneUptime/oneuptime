const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Schedule', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 1200000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });
        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show pricing plan modal when enable team rotation is clicked',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                const projectName = 'newproject';
                const newScheduleName = 'test';
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#create-project');
                await page.click('#create-project');
                await page.waitForSelector('#name');
                await page.type('#name', projectName);
                await page.$$eval(
                    'input[name="planId"]',
                    inputs => inputs[0].click() // select the first plan
                );
                await page.click('#btnCreateProject');
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                await page.$eval('#callSchedules a', elem => elem.click());
                const createScheduleBtn = `#btnCreateSchedule_${projectName}`;
                await page.waitForSelector(createScheduleBtn, {
                    visible: true,
                });
                await page.$eval(createScheduleBtn, elem => elem.click());

                await page.waitForSelector('#name');
                await page.type('#name', newScheduleName);
                await page.click('#btnCreateSchedule');
                await page.waitForSelector('#name', { hidden: true });

                await page.evaluate(() => {
                    let elem = document.querySelectorAll('.Table > tbody tr');
                    elem = Array.from(elem);
                    elem[0].click();
                });
                await page.waitForSelector('#enableTeamRotation');
                await page.click('#enableTeamRotation');

                const modal = await page.waitForSelector('#pricingPlanModal', {
                    visible: true,
                });
                expect(modal).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should show pricing plan modal when add on-call duty times is clicked',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval('#callSchedules a', elem => elem.click());

                await page.reload({ waitUntil: 'networkidle0' });
                await page.evaluate(() => {
                    let elem = document.querySelectorAll('.Table > tbody tr');
                    elem = Array.from(elem);
                    elem[0].click();
                });
                await page.waitForSelector('#addOnCallDutyTimes');
                await page.click('#addOnCallDutyTimes');

                const modal = await page.waitForSelector('#pricingPlanModal', {
                    visible: true,
                });
                expect(modal).toBeTruthy();
            });
        },
        operationTimeOut
    );
});
