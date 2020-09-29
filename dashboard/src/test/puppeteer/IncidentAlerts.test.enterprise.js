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
const callScheduleName = utils.generateRandomString();

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
            await init.addMonitorToComponent(componentName, monitorName, page);
            await init.addSchedule(callScheduleName, page);
            await page.waitForSelector('table tbody tr:first-child');
            await page.click('table tbody tr:first-child');
            await page.waitForSelector('#btnSaveMonitors');
            await page.click('#scheduleMonitor_0');
            await page.click('#btnSaveMonitors');
            await page.$eval('input[name="OnCallAlertBox[0].email"]',element=> element.click());
            await page.$eval('input[name="OnCallAlertBox[0].sms"]',element=> element.click());
            await page.$eval('input[name="OnCallAlertBox[0].call"]',element=> element.click());
            await init.selectByText('div[id="OnCallAlertBox[0].teams[0].teamMembers[0].userId"]','Test Name',page);
            await page.click('#saveSchedulePolicy');
            await init.setAlertPhoneNumber('+213696950030', '123456', page);
        });
        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        '',
        async () => {
            await cluster.execute(null, async ({ page }) => {});
        },
        operationTimeOut
    );
});
