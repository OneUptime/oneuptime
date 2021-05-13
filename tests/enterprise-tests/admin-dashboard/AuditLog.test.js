const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');
let browser, page;

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Audit Logs', () => {
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
        'Should delete all audit logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');
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
        'Should not delete audit logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');
            await page.waitForSelector('#deleteLog');
            await init.pageClick(page, '#deleteLog');
            await page.waitForSelector('#cancelAuditDelete');
            await init.pageClick(page, '#cancelAuditDelete');

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
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');
            await page.waitForSelector('#deleteLog');
            await init.pageClick(page, '#deleteLog');
            await page.waitForSelector('#confirmDelete');
            await init.pageClick(page, '#confirmDelete');
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toBeGreaterThanOrEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should show audit log(s) that match the search parameter(s)',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');
            await page.waitForSelector('#searchAuditLog');
            await init.pageClick(page, '#searchAuditLog');
            await init.pageType(page, '#searchAuditLog', 'probe');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toBeGreaterThanOrEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should not show any audit log if the search parameter(s) does not match any log',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');
            await page.waitForSelector('#searchAuditLog');
            await init.pageClick(page, '#searchAuditLog');
            await init.pageType(page, '#searchAuditLog', 'somerandom');

            const rowNum = await page.$$eval(
                'tbody tr.Table-row',
                rows => rows.length
            );

            expect(rowNum).toEqual(0);
        },
        operationTimeOut
    );

    test(
        'Should note that audit logs are currently enabled',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // count currently available logs
            let logCount = await page.waitForSelector(`#audit-log-count`);
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount);
            // goto other pages
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');

            // come back to logs page
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // get the new log count
            let newLogCount = await page.waitForSelector(`#audit-log-count`);
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount);
            // validate that the number has change
            expect(newLogCount).toBeGreaterThan(logCount);
        },
        operationTimeOut
    );
    test(
        'Should disable audit logs',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // visit the audit log settings page by clicking on settings first to show drop down
            await page.waitForSelector('#settings');
            await init.pageClick(page, '#settings');

            // click on th audit log
            await page.waitForSelector('#auditLog');
            await init.pageClick(page, '#auditLog');

            // turn audit log off
            await page.$eval('input[name=auditStatusToggler]', e => e.click());

            // click the submit button
            await page.waitForSelector('#auditLogSubmit');
            await init.pageClick(page, '#auditLogSubmit');

            // go back to audit logs page
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // look for the alert panel
            const alertPanelElement = await page.waitForSelector(
                `#auditLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'Should validate that audit logs are currently disabled and on page change no audit is logged',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // look for the alert panel
            const alertPanelElement = await page.waitForSelector(
                `#auditLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // count currently available logs
            let logCount = await page.waitForSelector(`#audit-log-count`);
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount);

            // goto other pages
            await page.waitForSelector('#probes');
            await init.pageClick(page, '#probes');

            // come back to logs page
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // validate that the number doesnt change
            let newLogCount = await page.waitForSelector(`#audit-log-count`);
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount);

            expect(logCount).toEqual(newLogCount);
        },
        operationTimeOut
    );
    test(
        'Should validate that audit logs are enabled and on page change audit is logged',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // count number of logs
            let logCount = await page.waitForSelector(`#audit-log-count`);
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount);

            // look for the alert panel
            const alertPanelElement = await page.waitForSelector(
                `#auditLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // find the a tag to enable logs and click on it
            await page.waitForSelector('#auditLogSetting');
            await init.pageClick(page, '#auditLogSetting');

            // enable logs
            await page.$eval('input[name=auditStatusToggler]', e => e.click());

            // click the submit button
            await page.waitForSelector('#auditLogSubmit');
            await init.pageClick(page, '#auditLogSubmit');

            // go back to audit logs
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs');
            await init.pageClick(page, '#auditLogs');

            // count new number of logs
            let newLogCount = await page.waitForSelector(`#audit-log-count`);
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount);

            // expect it to be greater now
            expect(newLogCount).toBeGreaterThan(logCount);
        },
        operationTimeOut
    );
});
