const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Audit Logs', () => {
    const operationTimeOut = 100000;

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

        // login user
        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.loginUser(user, page);
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
                await page.waitFor(5000);

                let afterDeleteText = "We don't have any logs yet";
                let text = await page.$eval('#aStatus', status => status.textContent);

                expect(text).toBeTruthy();
                expect(text).toBe(afterDeleteText);
            })
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
                await page.waitFor(2000);

                let text = await page.$eval('#aStatus', status => status.textContent);

                expect(text).toBeFalsy();
                expect(text).toBe('');
            })
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
                await page.waitFor(2000);

                let rowNum = await page.$$eval('tbody tr.Table-row', rows => rows.length);

                expect(rowNum).toBeGreaterThanOrEqual(rowNum);
            })
        },
        operationTimeOut
    );

    test(
        'Should show audit log(s) that match the search parameter',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#searchAuditLog');
                await page.type('#searchAuditLog', 'probe');
                await page.waitFor(2000);

                let rowNum = await page.$$eval('tbody tr.Table-row', rows => rows.length);

                expect(rowNum).toBeGreaterThanOrEqual(rowNum);
            })
        },
        operationTimeOut
    );

    test(
        'Should not show any audit log if the search parameter does not match any log',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#auditLogs');
                await page.click('#auditLogs');
                await page.waitForSelector('#searchAuditLog');
                await page.type('#searchAuditLog', 'somerandom');
                await page.waitFor(2000);

                let afterDeleteText = "We don't have any logs yet";
                let text = await page.$eval('#aStatus', status => status.textContent);

                expect(text).toBeTruthy();
                expect(text).toBe(afterDeleteText);
            })
        },
        operationTimeOut
    )
})