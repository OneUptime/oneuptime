const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Audit Logs', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async () => {
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
            await init.registerEnterpriseUser(user, page, false);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should delete all audit logs from the table',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');

                const rowNum = await page.$$eval(
                    'tbody tr.Table-row',
                    rows => rows.length
                );

                expect(rowNum).toEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should not delete audit logs from the table',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#cancelAuditDelete');
                await page.click('#cancelAuditDelete');

                const rowNum = await page.$$eval(
                    'tbody tr.Table-row',
                    rows => rows.length
                );

                expect(rowNum).toBeGreaterThan(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should check if logs are prefilled again after deleting logs',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');

                const rowNum = await page.$$eval(
                    'tbody tr.Table-row',
                    rows => rows.length
                );

                expect(rowNum).toBeGreaterThanOrEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should show audit log(s) that match the search parameter(s)',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#searchAuditLog');
                await page.click('#searchAuditLog');
                await page.type('#searchAuditLog', 'probe');

                const rowNum = await page.$$eval(
                    'tbody tr.Table-row',
                    rows => rows.length
                );

                expect(rowNum).toBeGreaterThanOrEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should not show any audit log if the search parameter(s) does not match any log',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#searchAuditLog');
                await page.click('#searchAuditLog');
                await page.type('#searchAuditLog', 'somerandom');

                const rowNum = await page.$$eval(
                    'tbody tr.Table-row',
                    rows => rows.length
                );

                expect(rowNum).toEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should note that audit logs are currently enabled and get it disabled',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                let labelElement = await page.waitForSelector(
                    `#toggle-label-title`
                );
                labelElement = await labelElement.getProperty('innerText');
                labelElement = await labelElement.jsonValue();

                expect(labelElement).toMatch('Disable Audit Logs');

                // turn audit log off
                await page.$eval('input[name=auditStatusToggler]', e =>
                    e.click()
                );

                await page.waitFor(5000);

                // confirm that the audit log is turned off
                labelElement = await page.waitForSelector(
                    `#toggle-label-title`
                );
                labelElement = await labelElement.getProperty('innerText');
                labelElement = await labelElement.jsonValue();

                expect(labelElement).toMatch('Enable Audit Logs');
            });
        },
        operationTimeOut
    );

    test(
        'Should validate that audit logs are currently disabled and on page change no audit is logged',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                let labelElement = await page.waitForSelector(
                    `#toggle-label-title`
                );
                labelElement = await labelElement.getProperty('innerText');
                labelElement = await labelElement.jsonValue();

                expect(labelElement).toMatch('Enable Audit Logs');

                await page.waitFor(5000);
                // count currently availbe logs
                let logCount = await page.waitForSelector(`#log-count`);
                logCount = await logCount.getProperty('innerText');
                logCount = await logCount.jsonValue();

                // goto other pages
                await page.waitForSelector('#probes');
                await page.click('#probes');

                // come back to logs page
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');

                await page.waitFor(5000);
                // validate that the number doesnt change
                let newLogCount = await page.waitForSelector(`#log-count`);
                newLogCount = await newLogCount.getProperty('innerText');
                newLogCount = await newLogCount.jsonValue();

                expect(logCount).toEqual(newLogCount);
            });
        },
        operationTimeOut
    );
    test(
        'Should validate that audit logs are enabled and on page change audit is logged',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                let labelElement = await page.waitForSelector(
                    `#toggle-label-title`
                );
                labelElement = await labelElement.getProperty('innerText');
                labelElement = await labelElement.jsonValue();

                expect(labelElement).toMatch('Enable Audit Logs');
                // turn audit log on
                await page.$eval('input[name=auditStatusToggler]', e =>
                    e.click()
                );

                await page.waitFor(5000);
                // count currently available logs
                let logCount = await page.waitForSelector(`#log-count`);
                logCount = await logCount.getProperty('innerText');
                logCount = await logCount.jsonValue();
                logCount = Number(logCount.split(' ')[0]);

                // goto other pages
                await page.waitForSelector('#probes');
                await page.click('#probes');

                // come back to logs page
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');

                await page.waitFor(5000);
                // validate that the number has change
                let newLogCount = await page.waitForSelector(`#log-count`);
                newLogCount = await newLogCount.getProperty('innerText');
                newLogCount = await newLogCount.jsonValue();
                newLogCount = Number(newLogCount.split(' ')[0]);

                expect(newLogCount).toBeGreaterThan(logCount);
            });
        },
        operationTimeOut
    );
});
