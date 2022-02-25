import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const priorityName = utils.generateRandomString();
const incidentTitle = utils.generateRandomString();
const newIncidentTitle = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);
        // add new monitor to component on parent project
        await init.addMonitorToComponent(componentName, monitorName, page);
        await init.addIncidentPriority(priorityName, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should navigate to details of monitor created with correct details',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and create an incident',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#createIncident_${monitorName}`
            );
            await init.page$Eval(page, `#createIncident_${monitorName}`, e =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            await init.selectDropdownValue(
                '#incidentPriority',
                priorityName,
                page
            );
            await init.pageClick(page, '#title', { clickCount: 3 });
            // await page.keyboard.press('Backspace');
            await init.pageType(page, '#title', incidentTitle);
            await init.page$Eval(page, '#createIncident', e => e.click());
            await init.pageWaitForSelector(page, '#closeIncident_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#closeIncident_0', elem =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '#numberOfIncidents');

            const selector = await init.page$Eval(
                page,
                '#numberOfIncidents',
                elem => elem.textContent
            );
            expect(selector).toMatch('1');

            await init.pageWaitForSelector(page, `#name_${priorityName}`, {
                visible: true,
                timeout: init.timeout,
            });
            const selector1 = `#name_${priorityName}`;
            const rowContent = await init.page$Eval(
                page,
                selector1,
                e => e.textContent
            );
            expect(rowContent).toMatch(priorityName);
            done();
        },
        operationTimeOut
    );

    test(
        "Should navigate to monitor's incident details and edit details",
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            const selector = `#incident_0`;
            await init.pageWaitForSelector(page, selector);
            await init.page$Eval(page, selector, e => e.click());
            const incidentTitleSelector = '#incidentTitle';
            await init.pageWaitForSelector(page, incidentTitleSelector, {
                visible: true,
                timeout: init.timeout,
            });
            let currentTitle = await init.page$Eval(
                page,
                incidentTitleSelector,
                e => e.textContent
            );
            expect(currentTitle).toEqual(incidentTitle);
            // The Edit Button has been removed and replaced with another functions
            await init.pageClick(page, '#incidentTitle');
            await init.pageClick(page, '#title', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await init.pageType(page, '#title', newIncidentTitle);
            await page.keyboard.press('Enter');
            await init.pageWaitForSelector(page, incidentTitleSelector);
            currentTitle = await init.page$Eval(
                page,
                incidentTitleSelector,
                e => e.textContent
            );
            expect(currentTitle).toEqual(newIncidentTitle);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and open the incident creation pop up',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // tab the create incident button over thee monitor view header
            await init.pageWaitForSelector(
                page,
                `#monitorCreateIncident_${monitorName}`
            );
            await init.page$Eval(
                page,
                `#monitorCreateIncident_${monitorName}`,
                e => e.click()
            );
            await init.pageWaitForSelector(page, '#incidentTitleLabel');
            let spanElement = await init.pageWaitForSelector(
                page,
                `#incidentTitleLabel`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('Create New Incident');
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of incidents and paginate incidents',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            const nextSelector = await init.pageWaitForSelector(
                page,
                '#btnNext'
            );
            await nextSelector.click();

            let incidentRows = '#numberOfIncidents';

            let countIncidents = await init.page$Eval(
                page,
                incidentRows,
                elem => elem.textContent
            );
            expect(countIncidents).toEqual('1');

            const prevSelector = await init.pageWaitForSelector(
                page,
                '#btnPrev'
            );
            await prevSelector.click();

            incidentRows = '#numberOfIncidents';
            countIncidents = await init.page$Eval(
                page,
                incidentRows,
                elem => elem.textContent
            );
            expect(countIncidents).toEqual('1');
            done();
        },
        operationTimeOut
    );

    test(
        'Should delete an incident and redirect to the monitor page',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            const selector = `#incident_0`;
            await init.pageWaitForSelector(page, selector);
            await init.page$Eval(page, selector, e => e.click());
            // click on advance option tab
            await init.pageClick(page, '.advanced-tab');
            await init.pageWaitForSelector(page, '#deleteIncidentButton', {
                visible: true,
                timeout: 100000,
            });
            await init.page$Eval(page, '#deleteIncidentButton', e => e.click());
            await init.pageWaitForSelector(page, '#confirmDeleteIncident', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#confirmDeleteIncident', e =>
                e.click()
            );
            await init.pageWaitForSelector(page, `#cb${monitorName}`, {
                visible: true,
                timeout: init.timeout,
            });

            //click on basic tab
            await init.pageClick(page, '.basic-tab');

            let incidentCountSpanElement = await init.pageWaitForSelector(
                page,
                `#numberOfIncidents`
            );
            incidentCountSpanElement = await incidentCountSpanElement.getProperty(
                'innerText'
            );
            incidentCountSpanElement = await incidentCountSpanElement.jsonValue();

            expect(incidentCountSpanElement).toMatch('0 Incident');
            done();
        },
        operationTimeOut
    );

    /**Tests Split */
});
