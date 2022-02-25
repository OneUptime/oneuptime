import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const slaName = 'fxPro';
const monitorUptime = '99.90';
const component = 'sampleComponent';
const monitor = 'sampleMonitor';

describe('Monitor SLA', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not add a monitor SLA if no name was specified',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.selectDropdownValue(
                '#monitorUptimeOption',
                monitorUptime,
                page
            );
            await init.page$Eval(page, '#isDefault', elem => elem.click());
            await init.pageClick(page, '#createSlaBtn');

            const monitorSla = await init.pageWaitForSelector(
                page,
                `#field-error`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(monitorSla).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime was not specified',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', slaName);
            await init.page$Eval(page, '#isDefault', elem => elem.click());
            await init.pageClick(page, '#createSlaBtn');

            const slaError = await init.pageWaitForSelector(page, `#slaError`, {
                visible: true,
                timeout: init.timeout,
            });
            expect(slaError).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime is not a numeric value',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue(
                '#monitorUptimeOption',
                'custom',
                page
            );
            await init.pageWaitForSelector(page, '#customMonitorUptime');
            await init.pageClick(page, '#customMonitorUptime');
            await init.pageType(page, '#customMonitorUptime', '12uptime');
            await init.page$Eval(page, '#isDefault', elem => elem.click());
            await init.pageClick(page, '#createSlaBtn');

            const uptimeError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(uptimeError).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime is greater than 100%',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue(
                '#monitorUptimeOption',
                'custom',
                page
            );
            await init.pageWaitForSelector(page, '#customMonitorUptime');
            await init.pageClick(page, '#customMonitorUptime');
            await init.pageType(page, '#customMonitorUptime', '120');
            await init.page$Eval(page, '#isDefault', elem => elem.click());
            await init.pageClick(page, '#createSlaBtn');

            const uptimeError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(uptimeError).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if monitor uptime is less than 1%',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue(
                '#monitorUptimeOption',
                'custom',
                page
            );
            await init.pageWaitForSelector(page, '#customMonitorUptime');
            await init.pageClick(page, '#customMonitorUptime');
            await init.pageType(page, '#customMonitorUptime', '0');
            await init.page$Eval(page, '#isDefault', elem => elem.click());
            await init.pageClick(page, '#createSlaBtn');

            const uptimeError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(uptimeError).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a monitor SLA if frequency is not a numeric value',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue('#frequencyOption', 'custom', page);
            await init.pageWaitForSelector(page, '#customFrequency');
            await init.pageClick(page, '#customFrequency');
            await init.pageType(page, '#customFrequency', '12days');
            await init.page$Eval(page, '#isDefault', elem => elem.click());
            await init.pageClick(page, '#createSlaBtn');

            const frequencyError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(frequencyError).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should add a monitor SLA',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#addMonitorSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue(
                '#monitorUptimeOption',
                monitorUptime,
                page
            );
            await init.pageClick(page, '#createSlaBtn');

            const monitorSla = await init.pageWaitForSelector(
                page,
                `#monitorSla_${slaName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(monitorSla).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should update a monitor SLA',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#editMonitorSlaBtn_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#editMonitorSlaBtn_0');
            await init.pageWaitForSelector(page, '#monitorSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#isDefault', elem => elem.click()); // set isDefault to false
            await init.pageClick(page, '#editSlaBtn');

            const setDefaultBtn = await init.pageWaitForSelector(
                page,
                `#defaultMonitorSlaBtn_0`,
                { hidden: true }
            );
            expect(setDefaultBtn).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should show monitor SLA indicator in a created monitor',
        async done => {
            await init.addMonitorToComponent(component, monitor, page);
            const slaIndicator = await init.pageWaitForSelector(
                page,
                `#noMonitorSlaBreached`,
                {
                    visible: true,
                }
            );
            expect(slaIndicator).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should show breached monitor SLA indicator when a monitor uptime is less than the specified uptime in the SLA',
        async done => {
            await init.addIncident(monitor, 'offline', page);
            await init.navigateToMonitorDetails(component, monitor, page);

            const breachedIndicator = await init.pageWaitForSelector(
                page,
                '#monitorSlaBreached',
                { visible: true, timeout: init.timeout }
            );
            expect(breachedIndicator).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a monitor SLA',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');

            await init.pageWaitForSelector(page, '#deleteMonitorSlaBtn_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#deleteMonitorSlaBtn_0');
            await init.pageWaitForSelector(page, '#DeleteMonitorSlaBtn');
            await init.pageClick(page, '#DeleteMonitorSlaBtn');

            const monitorSla = await init.pageWaitForSelector(
                page,
                `#monitorSla_${slaName}`,
                { hidden: true }
            );
            expect(monitorSla).toBeNull();
            done();
        },
        operationTimeOut
    );
});
