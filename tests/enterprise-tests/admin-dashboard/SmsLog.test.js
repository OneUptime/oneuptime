const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
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
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Should delete all SMS logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');
            await page.waitForSelector('#deleteLog');
            await init.pageClick(page, '#deleteLog');
            await page.waitForSelector('#confirmDelete');
            await init.pageClick(page, '#confirmDelete');
            await page.waitForSelector('#confirmDelete', { hidden: true });

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should not delete SMS logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');
            await page.waitForSelector('#deleteLog');
            await init.pageClick(page, '#deleteLog');
            await page.waitForSelector('#cancelSmsDelete');
            await init.pageClick(page, '#cancelSmsDelete');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toBeGreaterThan(0);
        },
        operationTimeOut
    );

    test(
        'Should check if logs are prefilled again after deleting logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');
            await page.waitForSelector('#deleteLog');
            await init.pageClick(page, '#deleteLog');
            await page.waitForSelector('#confirmDelete');
            await init.pageClick(page, '#confirmDelete');
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toBeGreaterThanOrEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should show SMS log(s) that match the search parameter(s)',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');
            await page.waitForSelector('#searchSmsLog');
            await init.pageClick(page, '#searchSmsLog');
            await init.pageType(page, '#searchSmsLog', 'probe');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toBeGreaterThanOrEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should not show any SMS log if the search parameter(s) does not match any log',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');
            await page.waitForSelector('#searchSmsLog');
            await init.pageClick(page, '#searchSmsLog');
            await init.pageType(page, '#searchSmsLog', 'somerandom');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should note that SMS logs are currently enabled',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // count currently available logs
            let logCount = await page.waitForSelector(`#log-count`);
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // goto other pages
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');

            // come back to logs page
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // get the new log count
            let newLogCount = await page.waitForSelector(`#log-count`);
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
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // visit the SMS log settings page by clicking on settings first to show drop down
            await page.waitForSelector('#settings');
            await init.pageClick(page, '#settings');

            // click on th SMS log
            await page.waitForSelector('#smsLog');
            await init.pageClick(page, '#smsLog');

            // turn SMS log off
            await page.$eval('input[name=smsStatusToggler]', e => e.click());

            // click the submit button
            await page.waitForSelector('#smsLogSubmit');
            await init.pageClick(page, '#smsLogSubmit');

            // go back to SMS logs page
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // look for the alert panel
            const alertPanelElement = await page.waitForSelector(
                `#smsLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'Should validate that SMS logs are currently disabled and on page change no SMS is logged',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // look for the alert panel
            const alertPanelElement = await page.waitForSelector(
                `#smsLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // count currently available logs
            let logCount = await page.waitForSelector(`#log-count`);
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // goto other pages
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');

            // come back to logs page
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // validate that the number doesnt change
            let newLogCount = await page.waitForSelector(`#log-count`);
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount.split(' ')[0]);

            expect(logCount).toEqual(newLogCount);
        },
        operationTimeOut
    );
    test(
        'Should validate that SMS logs are enabled and on page change SMS is logged',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // count number of logs
            let logCount = await page.waitForSelector(`#log-count`);
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount.split(' ')[0]);

            // look for the alert panel
            const alertPanelElement = await page.waitForSelector(
                `#smsLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // find the a tag to enable logs and click on it
            await page.waitForSelector('#smsLogSetting');
            await init.pageClick(page, '#smsLogSetting');

            // enable logs
            await page.$eval('input[name=smsStatusToggler]', e => e.click());

            // click the submit button
            await page.waitForSelector('#smsLogSubmit');
            await init.pageClick(page, '#smsLogSubmit');

            // go back to SMS logs
            await page.waitForSelector('#smsLogs');
            await init.pageClick(page, '#smsLogs');

            // count new number of logs
            let newLogCount = await page.waitForSelector(`#log-count`);
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount.split(' ')[0]);

            // expect it to be greater now
            expect(newLogCount).toBeGreaterThan(logCount);
        },
        operationTimeOut
    );
});
