// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

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
const callScheduleName = utils.generateRandomString();

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

        await init.registerEnterpriseUser(user, page);
        const enableSms = true;
        const enableCalls = true;
        const { accountSid, authToken, phoneNumber } = utils.twilioCredentials;
        const alertLimit = '100';
        await init.addGlobalTwilioSettings(
            enableSms,
            enableCalls,
            accountSid,
            authToken,
            phoneNumber,
            alertLimit,
            page
        );
        await init.logout(page);
        await init.loginUser(user, page);
        await init.setAlertPhoneNumber('+19173976123', '123456', page);
        await init.addMonitorToComponent(componentName, monitorName, page);
        await init.addAnExternalSubscriber(
            componentName,
            monitorName,
            'SMS',
            page,
            {
                countryCode: '+1',
                phoneNumber: '9173976128',
            }
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.addSchedule(callScheduleName, page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, 'table tbody tr:first-child');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'table tbody tr:first-child');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#btnSaveMonitors');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#scheduleMonitor_0');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#btnSaveMonitors');
        await init.page$Eval(
            page,
            'input[name="OnCallAlertBox[0].email"]',
            (element: $TSFixMe) => element.click()
        );
        await init.page$Eval(
            page,
            'input[name="OnCallAlertBox[0].sms"]',
            (element: $TSFixMe) => element.click()
        );
        await init.page$Eval(
            page,
            'input[name="OnCallAlertBox[0].call"]',
            (element: $TSFixMe) => element.click()
        );
        await init.selectDropdownValue(
            'div[id="OnCallAlertBox[0].teams[0].teamMembers[0].userId"]',
            'Test Name',
            page
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#saveSchedulePolicy');

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should send on-call and external subscribers alerts when an incident is created.',
        async (done: $TSFixMe) => {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.addIncident(monitorName, 'offline', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewIncident-0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewIncident-0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-4');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-4');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#TeamAlertLogBox');

            const firstOncallAlertStatusSelector =
                '#TeamAlertLogBox tbody tr:nth-last-of-type(1) td:last-of-type';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                firstOncallAlertStatusSelector
            );

            const firstOncallAlertStatus = await init.page$Eval(
                page,
                firstOncallAlertStatusSelector,
                (element: $TSFixMe) => element.textContent
            );

            expect(firstOncallAlertStatus).toEqual('Success');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#subscriberAlertTable');
            const subscriberAlertStatusSelector =
                '#subscriberAlertTable tbody tr:first-of-type td:nth-last-of-type(1)';
            const subscriberAlertTypeSelector =
                '#subscriberAlertTable tbody tr:first-of-type td:nth-last-of-type(2)';

            const subscriberAlertStatus = await init.page$Eval(
                page,
                subscriberAlertStatusSelector,
                (element: $TSFixMe) => element.textContent
            );
            expect(subscriberAlertStatus).toEqual('Sent');

            const subscriberAlertType = await init.page$Eval(
                page,
                subscriberAlertTypeSelector,
                (element: $TSFixMe) => element.textContent
            );
            expect(subscriberAlertType).toEqual('identified');
            done();
        },
        operationTimeOut
    );
});
