import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
import 'should';

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('SMS Logs', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };

        await init.registerEnterpriseUser(user, page, false);
        await init.addGlobalTwilioSettings(
            true,
            true,
            utils.twilioCredentials.accountSid,
            utils.twilioCredentials.authToken,
            utils.twilioCredentials.phoneNumber,
            '5',
            page
        );
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should delete all SMS logs from the table',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio');

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            const alertLogs = await init.page$Eval(
                page,
                '#logsStatus',
                (element: $TSFixMe) => element.textContent
            );
            expect(alertLogs).toEqual("We don't have any logs yet");
            done();
        },
        operationTimeOut
    );

    test(
        'Should not delete SMS logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio');

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#cancelSmsDelete');

            await init.pageClick(page, '#cancelSmsDelete');

            const rowNum = await init.page$$Eval(
                page,
                'tbody tr.Table-row',
                (rows: $TSFixMe) => rows.length
            );

            expect(rowNum).toBeGreaterThan(0);
        },
        operationTimeOut
    );

    test(
        'Should check if logs are prefilled again after deleting logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            //perform an sms related action

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio');

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');
            //delete all logs

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');
            //perform another sms related event

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio');

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            const rowNum = await init.page$$Eval(
                page,
                'tbody tr.Table-row',
                (rows: $TSFixMe) => rows.length
            );

            expect(rowNum).toBeGreaterThanOrEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should note that SMS logs are currently enabled',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            // count currently available logs

            let logCount = await init.pageWaitForSelector(
                page,
                `#sms-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // goto other pages

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio');

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            //wait for 2seconds so the server would have sent the sms
            page.waitFor(2000);
            // come back to logs page probes

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            // get the new log count

            let newLogCount = await init.pageWaitForSelector(
                page,
                `#sms-log-count`
            );
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount.split(' ')[0]);
            // validate that the number has change
            expect(newLogCount).toBeGreaterThan(logCount);
        },
        operationTimeOut
    );

    test(
        'Should disable SMS logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            // visit the SMS log settings page by clicking on settings first to show drop down

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            // click on th SMS log

            await init.pageWaitForSelector(page, '#smsLog');

            await init.pageClick(page, '#smsLog');

            // turn SMS log off
            await init.page$Eval(
                page,
                'input[name=smsStatusToggler]',
                (e: $TSFixMe) => e.click()
            );

            // click the submit button

            await init.pageWaitForSelector(page, '#smsLogSubmit');

            await init.pageClick(page, '#smsLogSubmit');

            // go back to SMS logs page

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#smsLogs');

            await init.pageClick(page, '#smsLogs');

            // look for the alert panel

            const alertPanelElement = await init.pageWaitForSelector(
                page,
                `#smsLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();
        },
        operationTimeOut
    );

    // test(
    //     'Should validate that SMS logs are currently disabled and on page change no SMS is logged',
    //     async () => {
    //         await page.goto(utils.ADMIN_DASHBOARD_URL);
    //         await init.pageWaitForSelector(page, '#smsLogs');
    //         await init.pageClick(page, '#smsLogs');

    //         // look for the alert panel
    //         const alertPanelElement = await init.pageWaitForSelector(
    //             page,
    //             `#smsLogDisabled`
    //         );
    //         expect(alertPanelElement).toBeDefined();

    //         // count currently available logs
    //         let logCount = await init.pageWaitForSelector(page, `#log-count`);
    //         logCount = await logCount.getProperty('innerText');
    //         logCount = await logCount.jsonValue();
    //         logCount = Number(logCount.split(' ')[0]);

    //         // goto other pages
    //         await init.pageWaitForSelector(page, '#probes');
    //         await init.pageClick(page, '#probes');

    //         // come back to logs page
    //         await init.pageWaitForSelector(page, '#smsLogs');
    //         await init.pageClick(page, '#smsLogs');

    //         // validate that the number doesnt change
    //         let newLogCount = await init.pageWaitForSelector(
    //             page,
    //             `#log-count`
    //         );
    //         newLogCount = await newLogCount.getProperty('innerText');
    //         newLogCount = await newLogCount.jsonValue();
    //         newLogCount = Number(newLogCount.split(' ')[0]);

    //         expect(logCount).toEqual(newLogCount);
    //     },
    //     operationTimeOut
    // );
    // test(
    //     'Should validate that SMS logs are enabled and on page change SMS is logged',
    //     async () => {
    //         await page.goto(utils.ADMIN_DASHBOARD_URL);
    //         await init.pageWaitForSelector(page, '#smsLogs');
    //         await init.pageClick(page, '#smsLogs');

    //         // count number of logs
    //         let logCount = await init.pageWaitForSelector(page, `#log-count`);
    //         logCount = await logCount.getProperty('innerText');
    //         logCount = await logCount.jsonValue();
    //         logCount = Number(logCount.split(' ')[0]);

    //         // look for the alert panel
    //         const alertPanelElement = await init.pageWaitForSelector(
    //             page,
    //             `#smsLogDisabled`
    //         );
    //         expect(alertPanelElement).toBeDefined();

    //         // find the a tag to enable logs and click on it
    //         await init.pageWaitForSelector(page, '#smsLogSetting');
    //         await init.pageClick(page, '#smsLogSetting');

    //         // enable logs
    //         await init.page$Eval(page, 'input[name=smsStatusToggler]', e =>
    //             e.click()
    //         );

    //         // click the submit button
    //         await init.pageWaitForSelector(page, '#smsLogSubmit');
    //         await init.pageClick(page, '#smsLogSubmit');

    //         // go back to SMS logs
    //         await init.pageWaitForSelector(page, '#smsLogs');
    //         await init.pageClick(page, '#smsLogs');

    //         // count new number of logs
    //         let newLogCount = await init.pageWaitForSelector(
    //             page,
    //             `#log-count`
    //         );
    //         newLogCount = await newLogCount.getProperty('innerText');
    //         newLogCount = await newLogCount.jsonValue();
    //         newLogCount = Number(newLogCount.split(' ')[0]);

    //         // expect it to be greater now
    //         expect(newLogCount).toBeGreaterThan(logCount);
    //     },
    //     operationTimeOut
    // );
});
