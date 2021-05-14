const utils = require('../../test-utils');
const puppeteer = require('puppeteer');
const init = require('../../test-init');

let page, browser;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

const projectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const scheduledMaintenanceName = utils.generateRandomString();
const scheduledMaintenanceDescription = utils.generateRandomString();

describe('Check scheduled maintenace', () => {
    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should create a status-page',
        async done => {
            await init.registerUser(user, page);
            await init.renameProject(projectName, page);

            // Create a Status-Page and Scheduled Maintenance to display in the Status-Page Url
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#statusPages', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`, {
                visible: true,
            });
            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#name', { visible: true, timeout: init.timeout });
            await page.waitForSelector('input[id=name]', { visible: true, timeout: init.timeout });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', statusPageName);
            await init.pageClick(page, '#btnCreateStatusPage');
            await page.waitForSelector('#statusPagesListContainer', {
                visible: true,
            });
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector(`#header-${statusPageName}`, {
                visible: true,
            });

            // To confirm the status-page name.
            let spanElement = await page.waitForSelector(
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
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await page.$eval('#components', el => el.click());

            // Fill and submit New Component form
            await page.waitForSelector('#form-new-component', {
                visible: true,
            });
            await page.waitForSelector('input[id=name]', { visible: true, timeout: init.timeout });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', componentName);
            await init.pageClick(page, 'button[type=submit]');

            // Create a Manual Monitor
            await page.waitForSelector('#form-new-monitor', { visible: true, timeout: init.timeout });
            await init.pageClick(page, 'input[id=name]', { visible: true, timeout: init.timeout });
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, '[data-testId=type_manual]');
            await page.waitForSelector('#description', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#description');
            await init.pageType(page, '#description', 'My Manual Monitor');
            await init.pageClick(page, 'button[type=submit]');

            // To confirm the manual monitor is created
            let spanElement = await page.waitForSelector(
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
        'should add monitor to status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#statusPages', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer', {
                visible: true,
            });
            await page.waitForSelector('#viewStatusPage', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector('#addMoreMonitors', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#addMoreMonitors');
            await init.selectByText(
                '#monitor-name',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#monitor-description');
            await init.pageType(
                page,
                '#monitor-description',
                'Status Page Description'
            );
            await init.pageClick(page, '#manual-monitor-checkbox');
            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await page.waitForSelector('#publicStatusPageUrl', {
                visible: true,
            });
            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the status-page
            let spanElement = await page.waitForSelector(
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
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#scheduledMaintenance', {
                visible: true,
            });
            await init.pageClick(page, '#scheduledMaintenance');
            await page.waitForSelector('#addScheduledEventButton', {
                visible: true,
            });
            await init.pageClick(page, '#addScheduledEventButton');

            await page.waitForSelector('#scheduledEventForm', {
                visible: true,
            });
            await page.waitForSelector('#name', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', scheduledMaintenanceName);

            await init.pageClick(page, '#description');
            await init.pageType(
                page,
                '#description',
                scheduledMaintenanceDescription
            );
            await page.waitForSelector('input[name=startDate]', {
                visible: true,
            });
            await init.pageClick(page, 'input[name=startDate]');
            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );
            await page.waitForSelector(
                'div.MuiDialogActions-root button:nth-child(2)',
                { hidden: true }
            );
            await init.pageClick(page, 'input[name=endDate]');
            await init.pageClick(
                page,
                'div.MuiPickersCalendar-week:nth-child(5) > div:nth-child(6)'
            ); // To select the last week and last day of the month.
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
            await page.waitForSelector(
                'div.MuiDialogActions-root button:nth-child(2)',
                { hidden: true }
            );
            await init.pageClick(page, '#createScheduledEventButton');
            await page.waitForSelector('#scheduledEventForm', {
                hidden: true,
            });
            // This is to confirm that the created scheduled maintenance is present and monitor is there.
            let scheduledMaintenance = await page.waitForSelector(
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
        'should view scheduled maintenance details in status-page',
        async done => {
            await page.waitForSelector('#statusPages', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer', {
                visible: true,
            });
            await page.waitForSelector('#viewStatusPage', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#viewStatusPage');

            await page.waitForSelector('#publicStatusPageUrl', {
                visible: true,
            });
            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm scheduled maintenance name
            await page.waitForSelector(
                `#event-name-${scheduledMaintenanceName}`
            );
            const eventName = await page.$eval(
                `#event-name-${scheduledMaintenanceName}`,
                elem => elem.textContent
            );
            expect(eventName).toMatch(scheduledMaintenanceName);

            // To confirm scheduled maintenance description
            await page.waitForSelector(
                `#event-description-${scheduledMaintenanceDescription}`,
                { visible: true, timeout: init.timeout }
            );
            const eventDescription = await page.$eval(
                `#event-description-${scheduledMaintenanceDescription}`,
                elem => elem.textContent
            );
            expect(eventDescription).toMatch(scheduledMaintenanceDescription);

            // To confirm scheduled maintenance date
            await page.waitForSelector('#event-date', { visible: true, timeout: init.timeout });
            const eventDate = await page.$eval(
                '#event-date',
                elem => elem.textContent
            );
            expect(eventDate).toBeDefined();

            // To confirm this is a future scheduled maintenance
            await page.waitForSelector('#ongoing-event', { visible: true, timeout: init.timeout });
            const futureEvent = await page.$eval(
                '#ongoing-event',
                elem => elem.textContent
            );
            expect(futureEvent).toMatch(futureEvent);

            done();
        },
        init.timeout
    );
});
