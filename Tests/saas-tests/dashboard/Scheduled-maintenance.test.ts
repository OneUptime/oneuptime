import utils from '../../test-utils';

import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import init from '../../test-init';

let page: $TSFixMe, browser: $TSFixMe;

const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

const projectName: string = utils.generateRandomString();
const statusPageName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();
const monitorName: string = utils.generateRandomString();
const scheduledMaintenanceName: string = utils.generateRandomString();
const scheduledMaintenanceDescription: string = utils.generateRandomString();

describe('Check scheduled maintenace', () => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should create a StatusPage',
        async (done: $TSFixMe) => {
            await init.registerUser(user, page);
            await init.renameProject(projectName, page);

            // Create a StatusPage and Scheduled Maintenance to display in the StatusPage Url
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(
                page,
                `#btnCreateStatusPage_${projectName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', statusPageName);

            await init.pageClick(page, '#btnCreateStatusPage');
            await init.pageWaitForSelector(page, '#statusPagesListContainer', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#viewStatusPage');

            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, `#header-${statusPageName}`, {
                visible: true,
                timeout: init.timeout,
            });

            // To confirm the StatusPage name.
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#header-${statusPageName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(statusPageName);

            done();
        },
        init.timeout
    );

    test(
        'should create a manual monitor',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', (el: $TSFixMe) =>
                el.click()
            );

            // Fill and submit New Component form
            await init.pageWaitForSelector(page, '#form-new-component', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', componentName);

            await init.pageClick(page, 'button[type=submit]');

            // Create a Manual Monitor
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', monitorName);

            await init.pageClick(page, '[data-testId=type_manual]');
            await init.pageWaitForSelector(page, '#description', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#description');

            await init.pageType(page, '#description', 'My Manual Monitor');

            await init.pageClick(page, 'button[type=submit]');

            // To confirm the manual monitor is created
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        init.timeout
    );

    test(
        'should add monitor to StatusPage',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#viewStatusPage', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addMoreMonitors');
            await init.selectDropdownValue(
                '#monitor-name-0',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#monitor-description-0');

            await init.pageType(
                page,
                '#monitor-description-0',
                'Status Page Description'
            );

            await init.pageClick(page, '#manual-monitor-checkbox-0');

            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await init.pageWaitForSelector(page, '#publicStatusPageUrl', {
                visible: true,
                timeout: init.timeout,
            });

            let link: $TSFixMe = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the StatusPage
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toMatch(monitorName);

            done();
        },
        init.timeout
    );

    test(
        'should create a scheduled maintenance',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#scheduledMaintenance');
            await init.pageWaitForSelector(page, '#addScheduledEventButton', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addScheduledEventButton');

            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', scheduledMaintenanceName);

            await init.pageClick(page, '#description');

            await init.pageType(
                page,
                '#description',
                scheduledMaintenanceDescription
            );
            await init.pageWaitForSelector(page, 'input[name=startDate]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[name=startDate]');

            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );
            await init.pageWaitForSelector(
                page,
                'div.MuiDialogActions-root button:nth-child(2)',
                { hidden: true }
            );

            await init.pageClick(page, 'input[name=endDate]');

            await init.pageClick(page, '.MuiPickersDay-daySelected'); // To select the current date but pick the last hour

            await init.pageClick(
                page,
                'span.MuiTypography-body1:nth-child(14)'
            ); // This selects '11'

            await init.pageClick(
                page,
                'span.MuiPickersClockNumber-clockNumber:nth-child(15)'
            ); // This selects '55'. 11:55 is the highest possible value from the clock library html elements

            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );
            await init.pageWaitForSelector(
                page,
                'div.MuiDialogActions-root button:nth-child(2)',
                { hidden: true }
            );

            await init.pageClick(page, '#createScheduledEventButton');
            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                hidden: true,
            });
            // This is to confirm that the created scheduled maintenance is present and monitor is there.
            let scheduledMaintenance: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#monitor-${monitorName}`,
                {
                    visible: true,
                }
            );
            scheduledMaintenance = await scheduledMaintenance.getProperty(
                'innerText'
            );
            scheduledMaintenance = await scheduledMaintenance.jsonValue();
            expect(scheduledMaintenance).toMatch(monitorName);

            done();
        },
        init.timeout
    );

    test(
        'should view scheduled maintenance details in StatusPage',
        async (done: $TSFixMe) => {
            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#viewStatusPage', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#viewStatusPage');

            await init.pageWaitForSelector(page, '#publicStatusPageUrl', {
                visible: true,
                timeout: init.timeout,
            });

            let link: $TSFixMe = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm scheduled maintenance name

            await init.pageWaitForSelector(
                page,
                `#event-name-${scheduledMaintenanceName}`
            );
            const eventName = await init.page$Eval(
                page,
                `#event-name-${scheduledMaintenanceName}`,
                (elem: $TSFixMe) => elem.textContent
            );
            expect(eventName).toMatch(scheduledMaintenanceName);

            // To confirm scheduled maintenance description
            await init.pageWaitForSelector(
                page,
                `#event-description-${scheduledMaintenanceDescription}`,
                { visible: true, timeout: init.timeout }
            );
            const eventDescription = await init.page$Eval(
                page,
                `#event-description-${scheduledMaintenanceDescription}`,
                (elem: $TSFixMe) => elem.textContent
            );
            expect(eventDescription).toMatch(scheduledMaintenanceDescription);

            // To confirm scheduled maintenance date
            await init.pageWaitForSelector(page, '#event-date', {
                visible: true,
                timeout: init.timeout,
            });
            const eventDate = await init.page$Eval(
                page,
                '#event-date',
                (elem: $TSFixMe) => elem.textContent
            );
            expect(eventDate).toBeDefined();

            // To confirm this is a future scheduled maintenance
            await init.pageWaitForSelector(page, '#ongoing-event', {
                visible: true,
                timeout: init.timeout,
            });
            const futureEvent = await init.page$Eval(
                page,
                '#ongoing-event',
                (elem: $TSFixMe) => elem.textContent
            );
            expect(futureEvent).toMatch(futureEvent);

            done();
        },
        init.timeout
    );
});
