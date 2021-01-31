const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

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
                await init.addProject(page, projectName);

                await page.waitForSelector('#onCallSchedules', {
                    visible: true,
                });
                await page.$eval('#onCallSchedules', elem => elem.click());
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
                expect(modal).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'should show pricing plan modal when add on-call duty times is clicked',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#onCallSchedules', {
                    visible: true,
                });
                await page.$eval('#onCallSchedules', elem => elem.click());

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
                expect(modal).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'should show the component name on the monitors',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await init.addComponent(componentName, page);
                await init.addMonitorToComponent(
                    null,
                    monitorName,
                    page,
                    componentName
                );
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#onCallSchedules', {
                    visible: true,
                });
                await page.$eval('#onCallSchedules', elem => elem.click());

                await page.reload({ waitUntil: 'networkidle0' });
                await page.evaluate(() => {
                    let elem = document.querySelectorAll('.Table > tbody tr');
                    elem = Array.from(elem);
                    elem[0].click();
                });
                await page.waitForTimeout(5000);

                let monitor = await page.$(
                    `label[id=scheduleMonitor_0] > div.Checkbox-label > span > span[title=${monitorName}]`
                );
                monitor = await monitor.getProperty('innerText');
                monitor = await monitor.jsonValue();
                expect(monitor).toEqual(`${componentName} / ${monitorName}`);
            });
        },
        operationTimeOut
    );

    test(
        'it should navigate to the oncall schedule details page from the oncall schedule list when the view schedule button is clicked',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                const projectName = 'newproject1';
                const newScheduleName = 'test';
                await init.addProject(page, projectName);

                await page.waitForSelector('#onCallSchedules', {
                    visible: true,
                });
                await page.$eval('#onCallSchedules', elem => elem.click());
                const createScheduleBtn = `#btnCreateSchedule_${projectName}`;
                await page.waitForSelector(createScheduleBtn, {
                    visible: true,
                });
                await page.$eval(createScheduleBtn, elem => elem.click());

                await page.waitForSelector('#name');
                await page.type('#name', newScheduleName);
                await page.click('#btnCreateSchedule');
                await page.waitForSelector('#viewOnCallSchedule', {
                    visible: true,
                });
                await page.click('#viewOnCallSchedule');
                await page.waitForSelector(`#cb${newScheduleName}`, {
                    visible: true,
                });
                const onCallScheduleName = await page.$eval(
                    `#cb${newScheduleName}`,
                    el => el.textContent
                );

                expect(onCallScheduleName).toEqual(newScheduleName);
            });
        },
        operationTimeOut
    );
});
