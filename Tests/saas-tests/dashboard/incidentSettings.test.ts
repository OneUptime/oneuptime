import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';
import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: $TSFixMe = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const componentName: $TSFixMe = utils.generateRandomString();
const monitorName: $TSFixMe = utils.generateRandomString();
const newName: string = 'Another';
const newDefaultIncidentTitle: string = 'TEST: {{monitorName}}';
const newDefaultIncidentDescription: string = 'TEST: {{incidentType}}';
const incidentType: string = 'offline';
const changedTitle: string = `${monitorName} is ${incidentType}.`;

describe('Incident Settings API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
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
        'Should show priority fields with default values.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            // when a project is created a default incident template is created automatically for it
            // the incident template name is set as Default

            const defaultTemplate: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#incident_template_Default'
            );
            expect(defaultTemplate).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not be able to delete default priority',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            const deleteBtn: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#deleteIncidentTemplateBtn_Default',
                { hidden: true }
            );
            expect(deleteBtn).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'Should update title, description and priority fields for a template',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(
                page,
                '#editIncidentTemplateBtn_Default'
            );

            await init.pageClick(page, '#editIncidentTemplateBtn_Default');

            await init.pageWaitForSelector(page, '#editTemplateForm');

            await init.pageWaitForSelector(page, '#name');
            await init.pageClick(page, '#name', { clickCount: 3 });
            await page.keyboard.press('Backspace');

            await init.pageType(page, '#name', newName);
            await init.selectDropdownValue(
                '#incidentTemplatePriority',
                'low',
                page
            );
            await init.pageClick(page, '#title', { clickCount: 3 });
            await page.keyboard.press('Backspace');

            await init.pageType(page, '#title', newDefaultIncidentTitle);

            await init.pageClick(page, '#description');
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');

            await init.pageType(
                page,
                '#description',
                newDefaultIncidentDescription
            );

            await init.pageClick(page, '#updateIncidentTemplate');
            await init.pageWaitForSelector(page, '#editTemplateForm', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(
                page,
                `#editIncidentTemplateBtn_${newName}`
            );

            await init.pageClick(page, `#editIncidentTemplateBtn_${newName}`);

            await init.pageWaitForSelector(page, '#editTemplateForm');
            const priorityFieldValue: $TSFixMe = await init.page$Eval(
                page,
                '#incidentTemplatePriority',
                (e: $TSFixMe) => e.textContent
            );
            expect(priorityFieldValue).toEqual('Low');
            const titleFieldValue: $TSFixMe = await init.page$Eval(
                page,
                '#title',
                (e: $TSFixMe) => e.value
            );
            expect(titleFieldValue).toEqual(newDefaultIncidentTitle);
            done();
        },
        operationTimeOut
    );

    test(
        'Should substitute variables in title, description when an incident is created',
        async (done: $TSFixMe) => {
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#monitorCreateIncident_${monitorName}`
            );

            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            await init.pageClick(page, '#title', { clickCount: 3 });

            await init.pageType(page, '#title', changedTitle);

            await init.pageWaitForSelector(page, '#createIncident');

            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            // Since the incident was created in the previous test and it is only one, navigating to component details still gives access to the created incident.
            //And this will avoid using fragile selector to navigate to the incident page since the incident name is out of this test scope
            // await init.navigateToComponentDetails(componentName, page);
            // selectors refactoring
            const incidentTitleSelector: string = '#incident_title_0 > p';
            //Incident Description is no longer on UI
            const incidentPrioritySelector: string = '#name_Low';

            await init.pageWaitForSelector(page, incidentTitleSelector);
            const title: $TSFixMe = await init.page$Eval(
                page,
                incidentTitleSelector,
                (e: $TSFixMe) => e.textContent
            );

            const incidentPriority: $TSFixMe = await init.page$Eval(
                page,
                incidentPrioritySelector,
                (e: $TSFixMe) => e.textContent
            );
            expect(title).toMatch(changedTitle);
            expect(incidentPriority).toMatch('Low');
            done();
        },
        operationTimeOut
    );
});
