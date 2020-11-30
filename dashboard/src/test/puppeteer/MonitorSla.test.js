const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const slaName = 'fxPro';
const monitorUptime = '99.90';
const component = 'sampleComponent';
const monitor = 'sampleMonitor';

describe('Monitor SLA', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });

        cluster.on('error', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should not add a monitor SLA if no name was specified',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await init.selectByText(
                    '#monitorUptimeOption',
                    monitorUptime,
                    page
                );
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#createSlaBtn');

                const monitorSla = await page.waitForSelector(`#field-error`, {
                    visible: true,
                });
                expect(monitorSla).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime was not specified',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.click('#name');
                await page.type('#name', slaName);
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#createSlaBtn');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                const slaError = await page.waitForSelector(`#slaError`, {
                    visible: true,
                });
                expect(slaError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime is not a numeric value',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.click('#name');
                await page.type('#name', slaName);
                await init.selectByText('#monitorUptimeOption', 'custom', page);
                await page.waitForSelector('#customMonitorUptime');
                await page.click('#customMonitorUptime');
                await page.type('#customMonitorUptime', '12uptime');
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#createSlaBtn');

                const uptimeError = await page.waitForSelector('#field-error', {
                    visible: true,
                });
                expect(uptimeError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime is greater than 100%',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.click('#name');
                await page.type('#name', slaName);
                await init.selectByText('#monitorUptimeOption', 'custom', page);
                await page.waitForSelector('#customMonitorUptime');
                await page.click('#customMonitorUptime');
                await page.type('#customMonitorUptime', '120');
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#createSlaBtn');

                const uptimeError = await page.waitForSelector('#field-error', {
                    visible: true,
                });
                expect(uptimeError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime is less than 1%',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.click('#name');
                await page.type('#name', slaName);
                await init.selectByText('#monitorUptimeOption', 'custom', page);
                await page.waitForSelector('#customMonitorUptime');
                await page.click('#customMonitorUptime');
                await page.type('#customMonitorUptime', '0');
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#createSlaBtn');

                const uptimeError = await page.waitForSelector('#field-error', {
                    visible: true,
                });
                expect(uptimeError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if frequency is not a numeric value',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.click('#name');
                await page.type('#name', slaName);
                await init.selectByText('#frequencyOption', 'custom', page);
                await page.waitForSelector('#customFrequency');
                await page.click('#customFrequency');
                await page.type('#customFrequency', '12days');
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#createSlaBtn');

                const frequencyError = await page.waitForSelector(
                    '#field-error',
                    {
                        visible: true,
                    }
                );
                expect(frequencyError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should add a monitor SLA',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#addMonitorSlaBtn', {
                    visible: true,
                });
                await page.click('#addMonitorSlaBtn');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.click('#name');
                await page.type('#name', slaName);
                await init.selectByText(
                    '#monitorUptimeOption',
                    monitorUptime,
                    page
                );
                await page.click('#createSlaBtn');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                const monitorSla = await page.waitForSelector(
                    `#monitorSla_${slaName}`,
                    { visible: true }
                );
                expect(monitorSla).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should update a monitor SLA',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#editMonitorSlaBtn_0', {
                    visible: true,
                });
                await page.click('#editMonitorSlaBtn_0');
                await page.waitForSelector('#monitorSlaForm', {
                    visible: true,
                });
                await page.$eval('#isDefault', elem => elem.click()); // set isDefault to false
                await page.click('#editSlaBtn');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                const setDefaultBtn = await page.waitForSelector(
                    `#defaultMonitorSlaBtn_0`,
                    { hidden: true }
                );
                expect(setDefaultBtn).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should show monitor SLA indicator in a created monitor',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.addMonitorToComponent(component, monitor, page);
                const slaIndicator = await page.waitForSelector(
                    `#noMonitorSlaBreached`,
                    {
                        visible: true,
                    }
                );
                expect(slaIndicator).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should show breached monitor SLA indicator when a monitor uptime is less than the specified uptime in the SLA',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.addIncident(monitor, 'offline', page);
                await init.navigateToMonitorDetails(component, monitor, page);

                const breachedIndicator = await page.waitForSelector(
                    '#monitorSlaBreached',
                    { visible: true }
                );
                expect(breachedIndicator).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a monitor SLA',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#monitor', { visible: true });
                await page.click('#monitor');

                await page.waitForSelector('#deleteMonitorSlaBtn_0', {
                    visible: true,
                });
                await page.click('#deleteMonitorSlaBtn_0');
                await page.waitForSelector('#DeleteMonitorSlaBtn');
                await page.click('#DeleteMonitorSlaBtn');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                const monitorSla = await page.waitForSelector(
                    `#monitorSla_${slaName}`,
                    { hidden: true }
                );
                expect(monitorSla).toBeNull();
            });
            done();
        },
        operationTimeOut
    );
});
