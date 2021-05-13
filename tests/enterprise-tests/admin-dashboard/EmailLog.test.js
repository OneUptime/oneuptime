const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Email Logs', () => {
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
        'Should delete all email logs from the table',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');
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
        'Should not delete email logs from the table',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#cancelEmailDelete');
                await page.click('#cancelEmailDelete');

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
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');
                await page.waitForSelector('#deleteLog');
                await page.click('#deleteLog');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

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
        'Should show email log(s) that match the search parameter(s)',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');
                await page.waitForSelector('#searchEmailLog');
                await page.click('#searchEmailLog');
                await page.type('#searchEmailLog', 'probe');

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
        'Should not show any email log if the search parameter(s) does not match any log',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#probes');
                await page.click('#probes');
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');
                await page.waitForSelector('#searchEmailLog');
                await page.click('#searchEmailLog');
                await page.type('#searchEmailLog', 'somerandom');

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
        'Should note that email logs are currently enabled',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

                // count currently available logs
                let logCount = await page.waitForSelector(`#log-count`);
                logCount = await logCount.getProperty('innerText');
                logCount = await logCount.jsonValue();
                logCount = Number(logCount.split(' ')[0]);

                // goto other pages
                await page.waitForSelector('#probes');
                await page.click('#probes');

                // come back to logs page
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

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
        'Should disable email logs',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

                // visit the email log settings page by clicking on settings first to show drop down
                await page.waitForSelector('#settings');
                await page.click('#settings');

                // click on th email log
                await page.waitForSelector('#emailLog');
                await page.click('#emailLog');

                // turn email log off
                await page.$eval('input[name=emailStatusToggler]', e =>
                    e.click()
                );

                // click the submit button
                await page.waitForSelector('#emailLogSubmit');
                await page.click('#emailLogSubmit');

                await page.waitForTimeout(5000);

                // go back to email logs page
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

                await page.waitForTimeout(5000);
                // look for the alert panel
                const alertPanelElement = await page.waitForSelector(
                    `#emailLogDisabled`
                );
                expect(alertPanelElement).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should validate that email logs are currently disabled and on page change no email is logged',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

                // look for the alert panel
                const alertPanelElement = await page.waitForSelector(
                    `#emailLogDisabled`
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
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

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
        'Should validate that email logs are enabled and on page change email is logged',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

                // count number of logs
                let logCount = await page.waitForSelector(`#log-count`);
                logCount = await logCount.getProperty('innerText');
                logCount = await logCount.jsonValue();
                logCount = Number(logCount.split(' ')[0]);

                // look for the alert panel
                const alertPanelElement = await page.waitForSelector(
                    `#emailLogDisabled`
                );
                expect(alertPanelElement).toBeDefined();

                // find the a tag to enable logs and click on it
                await page.waitForSelector('#emailLogSetting');
                await page.click('#emailLogSetting');

                // enable logs
                await page.$eval('input[name=emailStatusToggler]', e =>
                    e.click()
                );

                // click the submit button
                await page.waitForSelector('#emailLogSubmit');
                await page.click('#emailLogSubmit');

                await page.waitForTimeout(5000);

                // go back to email logs
                await page.waitForSelector('#emailLogs');
                await page.click('#emailLogs');

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
