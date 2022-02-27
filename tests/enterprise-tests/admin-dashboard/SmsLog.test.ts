// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('SMS Logs', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 3.
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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should delete all SMS logs from the table',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#confirmDelete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not delete SMS logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cancelSmsDelete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should check if logs are prefilled again after deleting logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            //perform an sms related action
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            //delete all logs
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#confirmDelete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#confirmDelete');
            //perform another sms related event
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should note that SMS logs are currently enabled',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');

            // count currently available logs
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let logCount = await init.pageWaitForSelector(
                page,
                `#sms-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // goto other pages
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#twilio');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            //wait for 2seconds so the server would have sent the sms
            page.waitFor(2000);
            // come back to logs page probes
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#probes');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#probes');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');

            // get the new log count
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should disable SMS logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');

            // visit the SMS log settings page by clicking on settings first to show drop down
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#settings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#settings');

            // click on th SMS log
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLog');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLog');

            // turn SMS log off
            await init.page$Eval(
                page,
                'input[name=smsStatusToggler]',
                (e: $TSFixMe) => e.click()
            );

            // click the submit button
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogSubmit');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogSubmit');

            // go back to SMS logs page
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#logs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsLogs');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsLogs');

            // look for the alert panel
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
