import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const user: $TSFixMe = {
    email,
    password,
};

const componentName: string = utils.generateRandomString();
const monitorName: string = utils.generateRandomString();

describe('Schedule', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show pricing plan modal when enable team rotation is clicked',
        async (done: $TSFixMe) => {
            const projectName: string = 'newproject';
            const newScheduleName: string = 'test';

            await init.addProject(page, projectName);

            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#onCallDuty', (elem: $TSFixMe) =>
                elem.click()
            );
            const createScheduleBtn: string = `#btnCreateSchedule_${projectName}`;
            await init.pageWaitForSelector(page, createScheduleBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, createScheduleBtn, (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#name');

            await init.pageType(page, '#name', newScheduleName);

            await init.pageClick(page, '#btnCreateSchedule');
            await init.pageWaitForSelector(page, '#name', { hidden: true });

            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');

                elem = Array.from(elem);

                elem[0].click();
            });

            await init.pageWaitForSelector(page, '#enableTeamRotation');

            await init.pageClick(page, '#enableTeamRotation');

            const modal = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(modal).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should show pricing plan modal when add on-call duty times is clicked',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#onCallDuty', (elem: $TSFixMe) =>
                elem.click()
            );

            await page.reload({ waitUntil: 'networkidle2' });
            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');

                elem = Array.from(elem);

                elem[0].click();
            });

            await init.pageWaitForSelector(page, '#addOnCallDutyTimes');

            await init.pageClick(page, '#addOnCallDutyTimes');

            const modal = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(modal).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should show the component name on the monitors',
        async (done: $TSFixMe) => {
            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName,
                page,

                componentName
            );
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#onCallDuty', (elem: $TSFixMe) =>
                elem.click()
            );

            await page.reload({ waitUntil: 'networkidle2' });
            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');

                elem = Array.from(elem);

                elem[0].click();
            });

            let monitor: $TSFixMe = await init.page$(
                page,
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
        async (done: $TSFixMe) => {
            const projectName: string = 'newproject1';
            const newScheduleName: string = 'test';

            await init.addProject(page, projectName);

            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#onCallDuty', (elem: $TSFixMe) =>
                elem.click()
            );
            const createScheduleBtn: string = `#btnCreateSchedule_${projectName}`;
            await init.pageWaitForSelector(page, createScheduleBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, createScheduleBtn, (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#name');

            await init.pageType(page, '#name', newScheduleName);

            await init.pageClick(page, '#btnCreateSchedule');
            await init.pageWaitForSelector(page, '#viewOnCallSchedule', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewOnCallSchedule');
            await init.pageWaitForSelector(page, `#cb${newScheduleName}`, {
                visible: true,
                timeout: init.timeout,
            });
            const onCallScheduleName = await init.page$Eval(
                page,
                `#cb${newScheduleName}`,
                (el: $TSFixMe) => el.textContent
            );

            expect(onCallScheduleName).toEqual(newScheduleName);
            done();
        },
        operationTimeOut
    );
});
