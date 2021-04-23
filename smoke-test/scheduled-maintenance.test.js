const utils = require('./test-utils');
const puppeteer = require('puppeteer');
const init = require('./test-init');

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
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test('should create a status-page', async done => {
        await init.registerUser(user, page);
        await init.renameProject(projectName, page);

        // Create a Status-Page and Scheduled Maintenance to display in the Status-Page Url
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
        await page.click(`#btnCreateStatusPage_${projectName}`);
        await page.waitForSelector('#name');
        await page.click('input[id=name]');
        await page.type('input[id=name]', statusPageName);
        await page.click('#btnCreateStatusPage');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        await page.waitForSelector(`#header-${statusPageName}`);

        // To confirm the status-page name.
        let spanElement = await page.waitForSelector(
            `#header-${statusPageName}`
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(statusPageName);

        done();
    }, 200000);

    test('should create a manual monitor', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#components');
        await page.$eval('#components', el => el.click());

        // Fill and submit New Component form
        await page.waitForSelector('#form-new-component');
        await page.click('input[id=name]');
        await page.type('input[id=name]', componentName);
        await page.click('button[type=submit]');

        // Create a Manual Monitor
        await page.waitForSelector('#form-new-monitor', { visible: true });
        await page.click('input[id=name]', { visible: true });
        await page.type('input[id=name]', monitorName);
        await page.click('[data-testId=type_manual]');
        await page.waitForSelector('#description');
        await page.click('#description');
        await page.type('#description', 'My Manual Monitor');
        await page.click('button[type=submit]');

        // To confirm the manual monitor is created
        let spanElement = await page.waitForSelector(
            `#monitor-title-${monitorName}`
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    }, 200000);

    test('should add monitor to status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        await page.waitForSelector('#addMoreMonitors');
        await page.click('#addMoreMonitors');
        await init.selectByText(
            '#monitor-name',
            `${componentName} / ${monitorName}`,
            page
        );
        await page.click('#monitor-description');
        await page.type('#monitor-description', 'Status Page Description');
        await page.click('#manual-monitor-checkbox');
        await page.click('#btnAddStatusPageMonitors');

        await page.waitForSelector('#publicStatusPageUrl');
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link);

        // To confirm the monitor is present in the status-page
        let spanElement = await page.waitForSelector(`#monitor-${monitorName}`);
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    }, 200000);

    test('should create a scheduled maintenance', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#scheduledMaintenance', {
            visible: true,
        });
        await page.click('#scheduledMaintenance');
        await page.waitForSelector('#addScheduledEventButton', {
            visible: true,
        });
        await page.click('#addScheduledEventButton');

        await page.waitForSelector('#scheduledEventForm', {
            visible: true,
        });
        await page.waitForSelector('#name');
        await page.click('#name');
        await page.type('#name', scheduledMaintenanceName);

        await page.click('#description');
        await page.type('#description', scheduledMaintenanceDescription);
        await page.waitForSelector('input[name=startDate]');
        await page.click('input[name=startDate]');
        await page.click('div.MuiDialogActions-root button:nth-child(2)');
        await page.waitForSelector(
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        await page.click('input[name=endDate]');
        await page.click(
            'div.MuiPickersCalendar-week:nth-child(5) > div:nth-child(6)'
        ); // To select the last week and last day of the month.
        await page.click('span.MuiTypography-body1:nth-child(14)'); // This selects '11'
        await page.click(
            'span.MuiPickersClockNumber-clockNumber:nth-child(15)'
        ); // This selects '55'. 11:55 is the highest possible value from the clock library html elements
        await page.click('div.MuiDialogActions-root button:nth-child(2)');
        await page.waitForSelector(
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        await page.click('#createScheduledEventButton');
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
    }, 200000);

    test('should view scheduled maintenance details in status-page', async done => {
        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');

        await page.waitForSelector('#publicStatusPageUrl');
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link);

        // To confirm scheduled maintenance name
        await page.waitForSelector(`#event-name-${scheduledMaintenanceName}`);
        const eventName = await page.$eval(
            `#event-name-${scheduledMaintenanceName}`,
            elem => elem.textContent
        );
        expect(eventName).toMatch(scheduledMaintenanceName);

        // To confirm scheduled maintenance description
        await page.waitForSelector(
            `#event-description-${scheduledMaintenanceDescription}`
        );
        const eventDescription = await page.$eval(
            `#event-description-${scheduledMaintenanceDescription}`,
            elem => elem.textContent
        );
        expect(eventDescription).toMatch(scheduledMaintenanceDescription);

        // To confirm scheduled maintenance date
        await page.waitForSelector('#event-date');
        const eventDate = await page.$eval(
            '#event-date',
            elem => elem.textContent
        );
        expect(eventDate).toBeDefined();

        // To confirm this is a future scheduled maintenance
        await page.waitForSelector('#ongoing-event');
        const futureEvent = await page.$eval(
            '#ongoing-event',
            elem => elem.textContent
        );
        expect(futureEvent).toMatch(futureEvent);

        done();
    }, 200000);
});
