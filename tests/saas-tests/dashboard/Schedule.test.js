const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user = {
    email,
    password,
};

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

describe('Schedule', () => {
    const operationTimeOut = 1000000;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should show pricing plan modal when enable team rotation is clicked',
        async done => {
            const projectName = 'newproject';
            const newScheduleName = 'test';
            await init.addProject(page, projectName);

            await page.waitForSelector('#onCallDuty', {
                visible: true,
            });
            await page.$eval('#onCallDuty', elem => elem.click());
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
            done();
        },
        operationTimeOut
    );

    test(
        'should show pricing plan modal when add on-call duty times is clicked',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#onCallDuty', {
                visible: true,
            });
            await page.$eval('#onCallDuty', elem => elem.click());

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

            done();
        },
        operationTimeOut
    );

    test(
        'should show the component name on the monitors',
        async done => {
            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName,
                page,
                componentName
            );
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#onCallDuty', {
                visible: true,
            });
            await page.$eval('#onCallDuty', elem => elem.click());

            await page.reload({ waitUntil: 'networkidle0' });
            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');
                elem = Array.from(elem);
                elem[0].click();
            });

            let monitor = await page.$(
                `label[id=scheduleMonitor_0] > div.Checkbox-label > span > span[title=${monitorName}]`
            );
            monitor = await monitor.getProperty('innerText');
            monitor = await monitor.jsonValue();
            expect(monitor).toEqual(`${componentName} / ${monitorName}`);
            done();
        },
        operationTimeOut
    );

    test(
        'it should navigate to the oncall schedule details page from the oncall schedule list when the view schedule button is clicked',
        async done => {
            const projectName = 'newproject1';
            const newScheduleName = 'test';
            await init.addProject(page, projectName);

            await page.waitForSelector('#onCallDuty', {
                visible: true,
            });
            await page.$eval('#onCallDuty', elem => elem.click());
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
            done();
        },
        operationTimeOut
    );
});
