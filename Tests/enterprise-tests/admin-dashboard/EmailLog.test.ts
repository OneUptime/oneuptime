import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
let browser: $TSFixMe, page: $TSFixMe;

describe('Email Logs', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };

        await init.registerEnterpriseUser(user, page, false);
        await init.addEmailCredentials(page, email);
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Should delete all email logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.testSmptSettings(page, email);

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            const rowNum: $TSFixMe = await init.page$$Eval(
                page,
                'tbody tr',
                (row: $TSFixMe) => {
                    return row.textContent;
                }
            );

            expect(rowNum).toEqual(undefined);
        },
        operationTimeOut
    );

    test(
        'Should not delete email logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.testSmptSettings(page, email);

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#cancelEmailDelete');

            await init.pageClick(page, '#cancelEmailDelete');

            const rowNum: $TSFixMe = await init.page$$Eval(
                page,
                'tbody tr.Table-row',
                (rows: $TSFixMe) => {
                    return rows.length;
                }
            );

            expect(rowNum).toBeGreaterThan(0);
        },
        operationTimeOut
    );

    test(
        'Should note that email logs are currently enabled',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');
            const alertPanelElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#emailLogDisabled`,
                { hidden: true }
            );
            expect(alertPanelElement).toEqual(null);
        },
        operationTimeOut
    );

    test(
        'Should disable email logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.testSmptSettings(page, email);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            // visit the email log settings page by clicking on settings first to show drop down

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            // click on th email log

            await init.pageWaitForSelector(page, '#emailLog');

            await init.pageClick(page, '#emailLog');

            // turn email log off

            await init.pageWaitForSelector(page, '.Toggler-wrap');

            await init.pageClick(page, '.Toggler-wrap');

            // click the submit button

            await init.pageWaitForSelector(page, '#emailLogSubmit');

            await init.pageClick(page, '#emailLogSubmit');

            // go back to logs page

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');
            //go to email logs page

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            // look for the alert panel

            const alertPanelElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#emailLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'Should validate that email logs are currently disabled and not save when an email related activity is performed',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            // look for the alert panel

            const alertPanelElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#emailLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // count currently available logs

            let logCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#email-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // test smpt credential inorder to get an email
            await init.testSmptSettings(page, email);

            // come back to logs page

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            // validate that the number doesnt change

            let newLogCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#email-log-count`
            );
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount.split(' ')[0]);

            expect(logCount).toEqual(newLogCount);
        },
        operationTimeOut
    );

    test(
        'Should validate that email logs are enabled and on performing email related activity email is logged again',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            //await init.testSmptSettings(page, email);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            // count number of logs

            let logCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#email-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // look for the alert panel

            const alertPanelElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#emailLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // find the a tag to enable logs and click on it

            await init.pageWaitForSelector(page, '#emailLogSetting');

            await init.pageClick(page, '#emailLogSetting');

            // enable logs
            await init.page$Eval(
                page,
                'input[name=emailStatusToggler]',
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            // click the submit button

            await init.pageWaitForSelector(page, '#emailLogSubmit');

            await init.pageClick(page, '#emailLogSubmit');

            // create email log by testing smpt settings
            await init.testSmptSettings(page, email);
            //go back to log email

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#emailLogs');

            await init.pageClick(page, '#emailLogs');

            // count new number of logs

            let newLogCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#email-log-count`
            );
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount.split(' ')[0]);

            // expect it to be greater now
            expect(newLogCount).toBeGreaterThan(logCount);
        },
        operationTimeOut
    );
});
