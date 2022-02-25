import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

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
const callScheduleName = utils.generateRandomString();

describe('Schedule', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
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
        await init.addSchedule(callScheduleName, page);
        await init.pageWaitForSelector(page, 'table tbody tr:first-child');
        await init.pageClick(page, 'table tbody tr:first-child');
        await init.pageWaitForSelector(page, '#btnSaveMonitors');
        await init.pageClick(page, '#scheduleMonitor_0');
        await init.pageClick(page, '#btnSaveMonitors');
        await init.page$Eval(
            page,
            'input[name="OnCallAlertBox[0].email"]',
            element => element.click()
        );
        await init.page$Eval(
            page,
            'input[name="OnCallAlertBox[0].sms"]',
            element => element.click()
        );
        await init.page$Eval(
            page,
            'input[name="OnCallAlertBox[0].call"]',
            element => element.click()
        );
        await init.selectDropdownValue(
            'div[id="OnCallAlertBox[0].teams[0].teamMembers[0].userId"]',
            'Test Name',
            page
        );
        await init.pageClick(page, '#saveSchedulePolicy');

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should send on-call and external subscribers alerts when an incident is created.',
        async done => {
            await init.addIncident(monitorName, 'offline', page);
            await init.pageWaitForSelector(page, '#viewIncident-0');
            await init.pageClick(page, '#viewIncident-0');
            await init.pageWaitForSelector(page, '#react-tabs-4');
            await init.pageClick(page, '#react-tabs-4');
            await init.pageWaitForSelector(page, '#TeamAlertLogBox');

            const firstOncallAlertStatusSelector =
                '#TeamAlertLogBox tbody tr:nth-last-of-type(1) td:last-of-type';
            await init.pageWaitForSelector(
                page,
                firstOncallAlertStatusSelector
            );

            const firstOncallAlertStatus = await init.page$Eval(
                page,
                firstOncallAlertStatusSelector,
                element => element.textContent
            );

            expect(firstOncallAlertStatus).toEqual('Success');

            await init.pageWaitForSelector(page, '#subscriberAlertTable');
            const subscriberAlertStatusSelector =
                '#subscriberAlertTable tbody tr:first-of-type td:nth-last-of-type(1)';
            const subscriberAlertTypeSelector =
                '#subscriberAlertTable tbody tr:first-of-type td:nth-last-of-type(2)';

            const subscriberAlertStatus = await init.page$Eval(
                page,
                subscriberAlertStatusSelector,
                element => element.textContent
            );
            expect(subscriberAlertStatus).toEqual('Sent');

            const subscriberAlertType = await init.page$Eval(
                page,
                subscriberAlertTypeSelector,
                element => element.textContent
            );
            expect(subscriberAlertType).toEqual('identified');
            done();
        },
        operationTimeOut
    );
});
