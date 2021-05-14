const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');
const {
    incidentDefaultSettings,
} = require('../../../../backend/backend/config/incidentDefaultSettings');
require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const newDefaultIncidentTitle = 'TEST: {{monitorName}}';
const newDefaultIncidentDescription = 'TEST: {{incidentType}}';
const incidentType = 'offline';
const inctidentTitleAfterSubstitution = `TEST: ${monitorName}`;
const inctidentDescriptionAfterSubstitution = `TEST: ${incidentType}`;

describe('Incident Settings API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Should fill title,description and priority fields with default values.',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#incidentSettings');
            await init.pageClick(page, '#incidentSettings');
            await page.waitForSelector('input[name=title]');
            const priorityFieldValue = await page.$eval(
                '#incidentPriority',
                e => e.textContent
            );

            expect(priorityFieldValue).toMatch('High');
            const titleFieldValue = await page.$eval(
                'input[name=title]',
                e => e.value
            );
            expect(titleFieldValue).toMatch(incidentDefaultSettings.title);
            const descriptionFieldValue = await page.$eval(
                '.ace_layer.ace_text-layer',
                e => e.textContent
            );
            expect(descriptionFieldValue).toMatch(
                incidentDefaultSettings.description
            );
            done();
        },
        operationTimeOut
    );

    test(
        'Should not delete default priority',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#incidentSettings');
            await init.pageClick(page, '#incidentSettings');
            await page.waitForSelector('.incident-priority-tab', {
                visible: true,
            });
            await page.$$eval('.incident-priority-tab', elems => elems[0].click());
            await page.waitForSelector('#priorityDelete_High_0');
            await init.pageClick(page, '#priorityDelete_High_0');
            const unableToDeleteDefault = await page.waitForSelector(
                '#message-modal-message',
                { visible: true }
            );
            expect(unableToDeleteDefault).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should update default title, description and priority fields',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#incidentSettings');
            await init.pageClick(page, '#incidentSettings');
            await page.waitForSelector('input[name=title]');
            await init.selectByText('#incidentPriority', 'low', page);
            await init.pageClick(page, 'input[name=title]', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await init.pageType(
                page,
                'input[name=title]',
                newDefaultIncidentTitle
            );

            await init.pageClick(page, '#description');
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await init.pageType(
                page,
                '#description',
                newDefaultIncidentDescription
            );
            await init.pageClick(page, '#saveButton');
            await page.reload({
                waitUntil: 'networkidle0',
            });

            await page.waitForSelector('input[name=title]');
            const priorityFieldValue = await page.$eval(
                '#incidentPriority',
                e => e.textContent
            );
            expect(priorityFieldValue).toEqual('Low');
            const titleFieldValue = await page.$eval(
                'input[name=title]',
                e => e.value
            );
            expect(titleFieldValue).toEqual(newDefaultIncidentTitle);
            const descriptionFieldValue = await page.$eval(
                '.ace_layer.ace_text-layer',
                e => e.textContent
            );
            expect(descriptionFieldValue).toEqual(
                newDefaultIncidentDescription
            );
            done();
        },
        operationTimeOut
    );

    test(
        'Should fill title, description and priority fields on the incident creation form with the default values',
        async done => {
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector(`#monitorCreateIncident_${monitorName}`);
            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            await page.waitForSelector('#title');

            const priorityFieldValue = await page.$eval(
                '#incidentPriority',
                e => e.textContent
            );
            expect(priorityFieldValue).toEqual('Low');
            const titleFieldValue = await page.$eval('#title', e => e.value);
            expect(titleFieldValue).toEqual(inctidentTitleAfterSubstitution);
            const descriptionFieldValue = await page.$eval(
                '.ace_layer.ace_text-layer',
                e => e.textContent
            );
            expect(descriptionFieldValue).toEqual(
                inctidentDescriptionAfterSubstitution
            );
            await init.selectByText('#incidentType', incidentType, page);
            await init.pageClick(page, '#createIncident');
            await page.waitForSelector('#closeIncident_0');
            await init.pageClick(page, '#closeIncident_0');
            done();
        },
        operationTimeOut
    );

    test(
        'Should substitute variables in title, description when an incident is created',
        async done => {
            // Since the incident was created in the previous test and it is only one, navigating to component details still gives access to the created incident.
            //And this will avoid using fragile selector to navigate to the incident page since the incident name is out of this test scope
            await init.navigateToComponentDetails(componentName, page);
            // selectors refactoring
            const incidentTitleSelector = '#incident_title > p';
            //Incident Description is no longer on UI
            const incidentPrioritySelector = '#name_Low';

            await page.waitForSelector(incidentTitleSelector);
            const title = await page.$eval(
                incidentTitleSelector,
                e => e.textContent
            );

            const incidentPriority = await page.$eval(
                incidentPrioritySelector,
                e => e.textContent
            );
            expect(title).toMatch(inctidentTitleAfterSubstitution);
            expect(incidentPriority).toMatch('Low');
            done();
        },
        operationTimeOut
    );

    test(
        'Should delete non-default priority',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#incidentSettings');
            await init.pageClick(page, '#incidentSettings');
            await page.waitForSelector('.incident-priority-tab', {
                visible: true,
            });
            await page.$$eval('.incident-priority-tab', elems => elems[0].click());
            await page.waitForSelector('#priorityDelete_High_0');
            await init.pageClick(page, '#priorityDelete_High_0');
            await page.waitForSelector('#RemoveIncidentPriority', {
                visible: true,
            });
            await init.pageClick(page, '#RemoveIncidentPriority');
            const deletedPriority = await page.waitForSelector(
                '#RemoveIncidentPriority',
                { hidden: true }
            );
            expect(deletedPriority).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should create a priority and set it as default',
        async done => {
            const customPriority = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#incidentSettings');
            await init.pageClick(page, '#incidentSettings');
            await page.waitForSelector('.incident-priority-tab', {
                visible: true,
            });
            await page.$$eval('.incident-priority-tab', elems => elems[0].click());
            // Add New Priority
            await page.waitForSelector('#addNewPriority');
            await init.pageClick(page, '#addNewPriority');
            await page.waitForSelector('#CreateIncidentPriority');
            await init.pageType(page, 'input[name=name]', customPriority);
            await init.pageClick(page, '#CreateIncidentPriority');
            await page.waitForSelector('#CreateIncidentPriority', {
                hidden: true,
            });
            await page.waitForSelector('#incidentPrioritiesList', {
                visible: true,
            });
            // Set the new Priority as Default
            await init.pageClick(
                page,
                `button#priorityDefault_${customPriority}_1`
            );
            await page.waitForSelector('#priorityDefaultModal');
            await init.pageClick(page, '#SetDefaultIncidentPriority');

            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('.incident-priority-tab', {
                visible: true,
            });
            await page.$$eval('.incident-priority-tab', elems => elems[0].click());

            let newDefaultPriority = await page.waitForSelector(
                `span#priorityDefault_${customPriority}_1_default`,
                { visible: true }
            );
            newDefaultPriority = await newDefaultPriority.getProperty(
                'innerText'
            );
            newDefaultPriority = await newDefaultPriority.jsonValue();
            expect(newDefaultPriority).toMatch('Default');

            done();
        },
        operationTimeOut
    );
});
