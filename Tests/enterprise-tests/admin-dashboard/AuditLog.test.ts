import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;

import 'should';

// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

describe('Audit Logs', () => {
    const operationTimeOut = init.timeout;

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
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Should delete all audit logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });
            const rowNum = await init.page$$Eval(
                page,
                'tbody tr',
                (row: $TSFixMe) => row.textContent
            );

            expect(rowNum).toEqual(undefined);
        },
        operationTimeOut
    );

    test(
        'Should not delete audit logs from the table',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#cancelAuditDelete');

            await init.pageClick(page, '#cancelAuditDelete');

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

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            await init.pageWaitForSelector(page, '#deleteLog');

            await init.pageClick(page, '#deleteLog');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

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
        'Should show audit log(s) that match the search parameter(s)',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            await init.pageWaitForSelector(page, '#searchAuditLog');

            await init.pageClick(page, '#searchAuditLog');

            await init.pageType(page, '#searchAuditLog', 'probe');

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
        'Should not show any audit log if the search parameter(s) does not match any log',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            await init.pageWaitForSelector(page, '#searchAuditLog');

            await init.pageClick(page, '#searchAuditLog');

            await init.pageType(page, '#searchAuditLog', 'somerandom');

            const rowNum = await init.page$$Eval(
                page,
                'tbody tr',
                (row: $TSFixMe) => row.textContent
            );

            expect(rowNum).toEqual(undefined);
        },
        operationTimeOut
    );

    test(
        'Should note that audit logs are currently enabled',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // count currently available logs

            let logCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#audit-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount);
            // goto other pages

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            // come back to logs page

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // get the new log count

            let newLogCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#audit-log-count`
            );

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

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // visit the audit log settings page by clicking on settings first to show drop down

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            // click on th audit log

            await init.pageWaitForSelector(page, '#auditLog');

            await init.pageClick(page, '#auditLog');

            // turn audit log off
            await init.page$Eval(
                page,
                'input[name=auditStatusToggler]',
                (e: $TSFixMe) => e.click()
            );

            // click the submit button

            await init.pageWaitForSelector(page, '#auditLogSubmit');

            await init.pageClick(page, '#auditLogSubmit');

            // go back to audit logs page

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // look for the alert panel

            const alertPanelElement = await init.pageWaitForSelector(
                page,
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

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // look for the alert panel

            const alertPanelElement = await init.pageWaitForSelector(
                page,
                `#auditLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // count currently available logs

            let logCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#audit-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount);

            // goto other pages

            await init.pageWaitForSelector(page, '#probes');

            await init.pageClick(page, '#probes');

            // come back to logs page

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // validate that the number doesnt change

            let newLogCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#audit-log-count`
            );
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

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // count number of logs

            let logCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#audit-log-count`
            );
            logCount = await logCount.getProperty('innerText');
            logCount = await logCount.jsonValue();
            logCount = Number(logCount);

            // look for the alert panel

            const alertPanelElement = await init.pageWaitForSelector(
                page,
                `#auditLogDisabled`
            );
            expect(alertPanelElement).toBeDefined();

            // find the a tag to enable logs and click on it

            await init.pageWaitForSelector(page, '#auditLogSetting');

            await init.pageClick(page, '#auditLogSetting');

            // enable logs
            await init.page$Eval(
                page,
                'input[name=auditStatusToggler]',
                (e: $TSFixMe) => e.click()
            );

            // click the submit button

            await init.pageWaitForSelector(page, '#auditLogSubmit');

            await init.pageClick(page, '#auditLogSubmit');

            // go back to audit logs

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');

            await init.pageWaitForSelector(page, '#auditLogs');

            await init.pageClick(page, '#auditLogs');

            // count new number of logs

            let newLogCount: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#audit-log-count`
            );
            newLogCount = await newLogCount.getProperty('innerText');
            newLogCount = await newLogCount.jsonValue();
            newLogCount = Number(newLogCount);

            // expect it to be greater now
            expect(newLogCount).toBeGreaterThan(logCount);
        },
        operationTimeOut
    );
});
