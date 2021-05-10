const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let slaName = 'fxPro';
const duration = '15';
const alertTime = '10';
const component = utils.generateRandomString();
const monitor = utils.generateRandomString();

const user = {
    email,
    password,
};
describe('Incident Communication SLA', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not add incident communication SLA if no name was specified',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector('#addIncidentSlaBtn', {
                visible: true,
            });
            await page.click('#addIncidentSlaBtn');

            await page.waitForSelector('#communicationSlaForm', {
                visible: true,
            });
            await page.click('#name');
            await page.type('#name', '  ');
            await init.selectByText('#durationOption', duration, page);
            await page.click('#alertTime');
            await page.type('#alertTime', alertTime);
            await page.click('#createSlaBtn');

            const slaError = await page.waitForSelector('#field-error', {
                visible: true,
            });
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not add incident communication SLA if alert time is greater or equal to duration',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector('#addIncidentSlaBtn', {
                visible: true,
            });
            await page.click('#addIncidentSlaBtn');

            await page.waitForSelector('#communicationSlaForm', {
                visible: true,
            });
            await page.click('#name');
            await page.type('#name', slaName);
            await init.selectByText('#durationOption', duration, page);
            await page.click('#alertTime');
            await page.type('#alertTime', duration);
            await page.click('#createSlaBtn');

            const slaError = await page.waitForSelector('#field-error', {
                visible: true,
            });
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not add incident communication SLA if alert time is not a number',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector('#addIncidentSlaBtn', {
                visible: true,
            });
            await page.click('#addIncidentSlaBtn');

            await page.waitForSelector('#communicationSlaForm', {
                visible: true,
            });
            await page.click('#name');
            await page.type('#name', slaName);
            await init.selectByText('#durationOption', duration, page);
            await page.click('#alertTime');
            await page.type('#alertTime', '12m');
            await page.click('#createSlaBtn');

            const slaError = await page.waitForSelector('#field-error', {
                visible: true,
            });
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should add incident communication SLA',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector('#addIncidentSlaBtn', {
                visible: true,
            });
            await page.click('#addIncidentSlaBtn');

            await page.waitForSelector('#communicationSlaForm', {
                visible: true,
            });
            await page.click('#name');
            await page.type('#name', slaName);
            await init.selectByText('#durationOption', duration, page);
            await page.click('#alertTime');
            await page.type('#alertTime', alertTime);
            await page.$eval('#isDefault', elem => elem.click());
            await page.click('#createSlaBtn');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });

            const sla = await page.waitForSelector(`#incidentSla_${slaName}`, {
                visible: true,
            });
            expect(sla).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not edit an incident communication SLA if there is no name',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector(`#editIncidentSlaBtn_${slaName}`, {
                visible: true,
            });
            await page.click(`#editIncidentSlaBtn_${slaName}`);

            await page.waitForSelector('#communicationSlaForm', {
                visible: true,
            });
            await page.click('#name', { clickCount: 3 });
            await page.type('#name', '    ');
            await page.click('#editSlaBtn');

            const slaError = await page.waitForSelector(`#field-error`, {
                visible: true,
            });
            expect(slaError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should edit an incident communication SLA',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector(`#editIncidentSlaBtn_${slaName}`, {
                visible: true,
            });
            await page.click(`#editIncidentSlaBtn_${slaName}`);

            await page.waitForSelector('#communicationSlaForm', {
                visible: true,
            });
            slaName = 'newFxPro';
            await page.click('#name', { clickCount: 3 });
            await page.type('#name', slaName);
            await page.click('#editSlaBtn');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });

            const sla = await page.waitForSelector(`#incidentSla_${slaName}`, {
                visible: true,
            });
            expect(sla).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should show incident communication SLA notification when an incident is created',
        async done => {
            await init.addMonitorToComponent(component, monitor, page);
            await page.waitForSelector(`#createIncident_${monitor}`, {
                visible: true,
            });
            await page.click(`#createIncident_${monitor}`);

            await page.waitForSelector('#createIncident');
            await init.selectByText('#incidentType', 'offline', page);
            await page.click('#createIncident');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.waitForSelector(`#incident_${monitor}_0`, {
                visible: true,
            });
            await page.click(`#incident_${monitor}_0`);
            const slaIndicator = await page.waitForSelector(
                '#slaIndicatorAlert',
                { visible: true }
            );

            await page.waitForSelector('#btnAcknowledge_0', {
                visible: true,
            });
            await page.click('#btnAcknowledge_0');
            await page.waitForSelector('#btnResolve_0', { visible: true });
            await page.click('#btnResolve_0');

            expect(slaIndicator).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should hide incident communication SLA notification when an incident is acknowledged',
        async done => {
            await init.addIncident(monitor, 'offline', page);
            await page.waitForSelector(`#incident_${monitor}_0`, {
                visible: true,
            });
            await page.click(`#incident_${monitor}_0`);

            await page.waitForSelector('#btnAcknowledge_0', {
                visible: true,
            });
            await page.click('#btnAcknowledge_0');
            await page.waitForSelector('#btnResolve_0', { visible: true });
            await page.click('#btnResolve_0');

            const slaIndicator = await page.waitForSelector(
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
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', {
                visible: true,
            });
            await page.click('#incidentSettings');

            // tab id for incident communication sla tab

            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[2].click()
            );

            await page.waitForSelector(`#deleteIncidentSlaBtn_${slaName}`, {
                visible: true,
            });
            await page.click(`#deleteIncidentSlaBtn_${slaName}`);

            await page.waitForSelector('#deleteIncidentSlaBtn', {
                visible: true,
            });
            await page.click('#deleteIncidentSlaBtn');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });

            const sla = await page.waitForSelector(`#incidentSla_${slaName}`, {
                hidden: true,
            });
            expect(sla).toBeNull();

            done();
        },
        operationTimeOut
    );
});
