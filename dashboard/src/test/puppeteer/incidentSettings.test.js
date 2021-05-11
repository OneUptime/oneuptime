const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
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
    const operationTimeOut = 500000;

    beforeAll(async () => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

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
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings');
            await page.click('#incidentSettings');
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
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings');
            await page.click('#incidentSettings');
            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[1].click()
            );
            await page.waitForSelector('#priorityDelete_High_0');
            await page.click('#priorityDelete_High_0');
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
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings');
            await page.click('#incidentSettings');
            await page.waitForSelector('input[name=title]');
            await init.selectByText('#incidentPriority', 'low', page);
            await page.click('input[name=title]', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type('input[name=title]', newDefaultIncidentTitle);

            await page.click('#description');
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.type('#description', newDefaultIncidentDescription);
            await page.click('#saveButton');
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
            await page.click(`#monitorCreateIncident_${monitorName}`);
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
            await page.click('#createIncident');
            await page.waitForSelector('#closeIncident_0');
            await page.click('#closeIncident_0');
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
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings');
            await page.click('#incidentSettings');
            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[1].click()
            );
            await page.waitForSelector('#priorityDelete_High_0');
            await page.click('#priorityDelete_High_0');
            await page.waitForSelector('#RemoveIncidentPriority', {
                visible: true,
            });
            await page.click('#RemoveIncidentPriority');
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
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings');
            await page.click('#incidentSettings');
            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[1].click()
            );
            // Add New Priority
            await page.waitForSelector('#addNewPriority');
            await page.click('#addNewPriority');
            await page.waitForSelector('#CreateIncidentPriority');
            await page.type('input[name=name]', customPriority);
            await page.click('#CreateIncidentPriority');
            await page.waitForSelector('#CreateIncidentPriority', {
                hidden: true,
            });
            await page.waitForSelector('#incidentPrioritiesList', {
                visible: true,
            });
            // Set the new Priority as Default
            await page.click(`button#priorityDefault_${customPriority}_1`);
            await page.waitForSelector('#priorityDefaultModal');
            await page.click('#SetDefaultIncidentPriority');

            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('ul#customTabList > li', {
                visible: true,
            });
            await page.$$eval('ul#customTabList > li', elems =>
                elems[1].click()
            );

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
