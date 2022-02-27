// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user = {
    email,
    password,
};

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Schedule', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show pricing plan modal when enable team rotation is clicked',
        async (done: $TSFixMe) => {
            const projectName = 'newproject';
            const newScheduleName = 'test';
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"newproject"' is not assignable ... Remove this comment to see the full error message
            await init.addProject(page, projectName);

            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#onCallDuty', (elem: $TSFixMe) =>
                elem.click()
            );
            const createScheduleBtn = `#btnCreateSchedule_${projectName}`;
            await init.pageWaitForSelector(page, createScheduleBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, createScheduleBtn, (elem: $TSFixMe) =>
                elem.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', newScheduleName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnCreateSchedule');
            await init.pageWaitForSelector(page, '#name', { hidden: true });

            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');
                // @ts-expect-error ts-migrate(2741) FIXME: Property 'item' is missing in type 'Element[]' but... Remove this comment to see the full error message
                elem = Array.from(elem);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
                elem[0].click();
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#enableTeamRotation');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element[]' is not assignable to type 'NodeLi... Remove this comment to see the full error message
                elem = Array.from(elem);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
                elem[0].click();
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addOnCallDutyTimes');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show the component name on the monitors',
        async (done: $TSFixMe) => {
            await init.addComponent(componentName, page);
            await init.addMonitorToComponent(
                null,
                monitorName,
                page,
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 4.
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element[]' is not assignable to type 'NodeLi... Remove this comment to see the full error message
                elem = Array.from(elem);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
                elem[0].click();
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let monitor = await init.page$(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'it should navigate to the oncall schedule details page from the oncall schedule list when the view schedule button is clicked',
        async (done: $TSFixMe) => {
            const projectName = 'newproject1';
            const newScheduleName = 'test';
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"newproject1"' is not assignable... Remove this comment to see the full error message
            await init.addProject(page, projectName);

            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#onCallDuty', (elem: $TSFixMe) =>
                elem.click()
            );
            const createScheduleBtn = `#btnCreateSchedule_${projectName}`;
            await init.pageWaitForSelector(page, createScheduleBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, createScheduleBtn, (elem: $TSFixMe) =>
                elem.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', newScheduleName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnCreateSchedule');
            await init.pageWaitForSelector(page, '#viewOnCallSchedule', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
