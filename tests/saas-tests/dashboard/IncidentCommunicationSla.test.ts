import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const slaName = 'fxPro';
const newSlaName = 'newFxPro';
const duration = '15';
const alertTime = '10';
const component = utils.generateRandomString();
const monitor = utils.generateRandomString();

const user = {
    email,
    password,
};

describe('Incident Communication SLA', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not add incident communication SLA if no name was specified',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(page, '#addIncidentSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addIncidentSlaBtn');

            await init.pageWaitForSelector(page, '#communicationSlaForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', '  ');
            await init.selectDropdownValue('#durationOption', duration, page);

            await init.pageClick(page, '#alertTime');

            await init.pageType(page, '#alertTime', alertTime);

            await init.pageClick(page, '#createSlaBtn');

            const slaError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not add incident communication SLA if alert time is greater or equal to duration',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(page, '#addIncidentSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addIncidentSlaBtn');

            await init.pageWaitForSelector(page, '#communicationSlaForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue('#durationOption', duration, page);

            await init.pageClick(page, '#alertTime');

            await init.pageType(page, '#alertTime', duration);

            await init.pageClick(page, '#createSlaBtn');

            const slaError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not add incident communication SLA if alert time is not a number',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(page, '#addIncidentSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addIncidentSlaBtn');

            await init.pageWaitForSelector(page, '#communicationSlaForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue('#durationOption', duration, page);

            await init.pageClick(page, '#alertTime');

            await init.pageType(page, '#alertTime', '12m');

            await init.pageClick(page, '#createSlaBtn');

            const slaError = await init.pageWaitForSelector(
                page,
                '#field-error',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should add incident communication SLA',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(page, '#addIncidentSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addIncidentSlaBtn');

            await init.pageWaitForSelector(page, '#communicationSlaForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', slaName);
            await init.selectDropdownValue('#durationOption', duration, page);

            await init.pageClick(page, '#alertTime');

            await init.pageType(page, '#alertTime', alertTime);
            await init.page$Eval(page, '#isDefault', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageClick(page, '#createSlaBtn');

            const sla = await init.pageWaitForSelector(
                page,
                `#incidentSla_${slaName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(sla).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not edit an incident communication SLA if there is no name',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(
                page,
                `#editIncidentSlaBtn_${slaName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#editIncidentSlaBtn_${slaName}`);

            await init.pageWaitForSelector(page, '#communicationSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name', { clickCount: 3 });

            await init.pageType(page, '#name', '    ');

            await init.pageClick(page, '#editSlaBtn');

            const slaError = await init.pageWaitForSelector(
                page,
                `#field-error`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should edit an incident communication SLA',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(
                page,
                `#editIncidentSlaBtn_${slaName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#editIncidentSlaBtn_${slaName}`);

            await init.pageWaitForSelector(page, '#communicationSlaForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name', { clickCount: 3 });

            await init.pageType(page, '#name', newSlaName);

            await init.pageClick(page, '#editSlaBtn');

            const sla = await init.pageWaitForSelector(
                page,
                `#incidentSla_${newSlaName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(sla).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should show incident communication SLA notification when an incident is created',
        async (done: $TSFixMe) => {
            await init.addMonitorToComponent(component, monitor, page);
            await init.pageWaitForSelector(page, `#createIncident_${monitor}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#createIncident_${monitor}`);

            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'offline', page);

            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, `#incident_0`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#incident_0`);
            const slaIndicator = await init.pageWaitForSelector(
                page,
                '#slaIndicatorAlert',
                { visible: true, timeout: init.timeout }
            );

            await init.pageWaitForSelector(page, '#btnAcknowledge_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnAcknowledge_0');
            await init.pageWaitForSelector(page, '#btnResolve_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnResolve_0');

            expect(slaIndicator).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should hide incident communication SLA notification when an incident is acknowledged',
        async (done: $TSFixMe) => {
            await init.addIncident(monitor, 'offline', page);
            await init.pageWaitForSelector(page, `#incident_0`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#incident_0`);

            await init.pageWaitForSelector(page, '#btnAcknowledge_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnAcknowledge_0');
            await init.pageWaitForSelector(page, '#btnResolve_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btnResolve_0');

            const slaIndicator = await init.pageWaitForSelector(
                page,
                '#slaIndicatorAlert',
                { hidden: true }
            );
            expect(slaIndicator).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'should delete an incident communication SLA',
        async (done: $TSFixMe) => {
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
            await init.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#incidentSettings');

            // tab id for incident communication sla tab

            await init.pageWaitForSelector(page, '.communication-sla-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.communication-sla-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            await init.pageWaitForSelector(
                page,
                `#deleteIncidentSlaBtn_${newSlaName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#deleteIncidentSlaBtn_${newSlaName}`);

            await init.pageWaitForSelector(page, '#deleteIncidentSlaBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteIncidentSlaBtn');

            const sla = await init.pageWaitForSelector(
                page,
                `#incidentSla_${newSlaName}`,
                {
                    hidden: true,
                }
            );
            expect(sla).toBeNull();

            done();
        },
        operationTimeOut
    );
});
