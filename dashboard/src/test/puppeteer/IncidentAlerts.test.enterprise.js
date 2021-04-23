const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user ={
    email,
    password
}

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const callScheduleName = utils.generateRandomString();

describe('Schedule', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(2000000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
      
            await init.registerEnterpriseUser(user, page);
            const enableSms = true;
            const enableCalls = true;
            const {
                accountSid,
                authToken,
                phoneNumber,
            } = utils.twilioCredentials;
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
                    phoneNumber: '9173976123',
                }
            );
            await init.addSchedule(callScheduleName, page);
            await page.waitForSelector('table tbody tr:first-child');
            await page.click('table tbody tr:first-child');
            await page.waitForSelector('#btnSaveMonitors');
            await page.click('#scheduleMonitor_0');
            await page.click('#btnSaveMonitors');
            await page.$eval('input[name="OnCallAlertBox[0].email"]', element =>
                element.click()
            );
            await page.$eval('input[name="OnCallAlertBox[0].sms"]', element =>
                element.click()
            );
            await page.$eval('input[name="OnCallAlertBox[0].call"]', element =>
                element.click()
            );
            await init.selectByText(
                'div[id="OnCallAlertBox[0].teams[0].teamMembers[0].userId"]',
                'Test Name',
                page
            );
            await page.click('#saveSchedulePolicy');
       
        done();
    });

    afterAll(async done => {       
        await browser.close();
        done();
    });

    test(
        'should send on-call and external subscribers alerts when an incident is created.',
        async (done) => {
           
                await init.addIncident(monitorName, 'offline', page);
                await page.waitForSelector('#viewIncident-0');                
                await page.click('#viewIncident-0');
                await page.waitForSelector('#react-tabs-4');
                await page.click('#react-tabs-4');
                await page.waitForSelector('#TeamAlertLogBox');

                const firstOncallAlertStatusSelector =
                    '#TeamAlertLogBox tbody tr:nth-last-of-type(1) td:last-of-type';
                const secondOncallAlertStatusSelector =
                    '#TeamAlertLogBox tbody tr:nth-last-of-type(2) td:last-of-type';

                await page.waitForSelector(firstOncallAlertStatusSelector);

                const firstOncallAlertStatus = await page.$eval(
                    firstOncallAlertStatusSelector,
                    element => element.textContent
                );
                const secondOncallAlertStatus = await page.$eval(
                    secondOncallAlertStatusSelector,
                    element => element.textContent
                );

                expect(firstOncallAlertStatus).toEqual('Success');
                expect(secondOncallAlertStatus).toEqual('Success');

                await page.waitForSelector('#subscriberAlertTable');
                const subscriberAlertStatusSelector =
                    '#subscriberAlertTable tbody tr:first-of-type td:nth-last-of-type(1)';
                const subscriberAlertTypeSelector =
                    '#subscriberAlertTable tbody tr:first-of-type td:nth-last-of-type(2)';

                const subscriberAlertStatus = await page.$eval(
                    subscriberAlertStatusSelector,
                    element => element.textContent
                );
                expect(subscriberAlertStatus).toEqual('Sent');

                const subscriberAlertType = await page.$eval(
                    subscriberAlertTypeSelector,
                    element => element.textContent
                );
                expect(subscriberAlertType).toEqual('identified');
            done();
           
        },
        operationTimeOut
    );
});
