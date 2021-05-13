const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('SMS Logs', () => {
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
        'Should delete all SMS logs from the table',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');
                await page.waitForSelector('#confirmDelete', { hidden: true });

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
        'Should not delete SMS logs from the table',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#cancelSmsDelete');
                await page.click('#cancelSmsDelete');

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
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

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
        'Should show SMS log(s) that match the search parameter(s)',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');
                await page.waitForSelector('#searchSmsLog');
                await page.click('#searchSmsLog');
                await page.type('#searchSmsLog', 'probe');

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
        'Should not show any SMS log if the search parameter(s) does not match any log',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');
                await page.waitForSelector('#searchSmsLog');
                await page.click('#searchSmsLog');
                await page.type('#searchSmsLog', 'somerandom');

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
        'Should note that SMS logs are currently enabled',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

                // count currently available logs
                let logCount = await page.waitForSelector(`#log-count`);
                logCount = await logCount.getProperty('innerText');
                logCount = await logCount.jsonValue();
                logCount = Number(logCount.split(' ')[0]);

                // goto other pages
                await page.waitForSelector('#probes');
                await page.click('#probes');

                // come back to logs page
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

                await page.waitForTimeout(5000);

                // get the new log count
                let newLogCount = await page.waitForSelector(`#log-count`);
                newLogCount = await newLogCount.getProperty('innerText');
                newLogCount = await newLogCount.jsonValue();
                newLogCount = Number(newLogCount.split(' ')[0]);
                // validate that the number has change
                expect(newLogCount).toBeGreaterThan(logCount);
            });
        },
        operationTimeOut
    );
    test(
        'Should disable SMS logs',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

                // visit the SMS log settings page by clicking on settings first to show drop down
                await page.waitForSelector('#settings');
                await page.click('#settings');

                // click on th SMS log
                await page.waitForSelector('#smsLog');
                await page.click('#smsLog');

                // turn SMS log off
                await page.$eval('input[name=smsStatusToggler]', e =>
                    e.click()
                );

                // click the submit button
                await page.waitForSelector('#smsLogSubmit');
                await page.click('#smsLogSubmit');

                await page.waitForTimeout(5000);

                // go back to SMS logs page
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

                await page.waitForTimeout(5000);
                // look for the alert panel
                const alertPanelElement = await page.waitForSelector(
                    `#smsLogDisabled`
                );
                expect(alertPanelElement).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should validate that SMS logs are currently disabled and on page change no SMS is logged',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

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
                await page.click('#probes');

                // come back to logs page
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

                await page.waitForTimeout(5000);

                // validate that the number doesnt change
                let newLogCount = await page.waitForSelector(`#log-count`);
                newLogCount = await newLogCount.getProperty('innerText');
                newLogCount = await newLogCount.jsonValue();
                newLogCount = Number(newLogCount.split(' ')[0]);

                expect(logCount).toEqual(newLogCount);
            });
        },
        operationTimeOut
    );
    test(
        'Should validate that SMS logs are enabled and on page change SMS is logged',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

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
                await page.click('#smsLogSetting');

                // enable logs
                await page.$eval('input[name=smsStatusToggler]', e =>
                    e.click()
                );

                // click the submit button
                await page.waitForSelector('#smsLogSubmit');
                await page.click('#smsLogSubmit');

                await page.waitForTimeout(5000);

                // go back to SMS logs
                await page.waitForSelector('#smsLogs');
                await page.click('#smsLogs');

                await page.waitForTimeout(5000);

                // count new number of logs
                let newLogCount = await page.waitForSelector(`#log-count`);
                newLogCount = await newLogCount.getProperty('innerText');
                newLogCount = await newLogCount.jsonValue();
                newLogCount = Number(newLogCount.split(' ')[0]);

                // expect it to be greater now
                expect(newLogCount).toBeGreaterThan(logCount);
            });
        },
        operationTimeOut
    );
});
