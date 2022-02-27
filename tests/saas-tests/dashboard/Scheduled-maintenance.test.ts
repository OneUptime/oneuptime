import utils from '../../test-utils';
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import init from '../../test-init';

let page: $TSFixMe, browser: $TSFixMe;

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

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Check scheduled maintenace', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create a status-page',
        async (done: $TSFixMe) => {
            await init.registerUser(user, page);
            await init.renameProject(projectName, page);

            // Create a Status-Page and Scheduled Maintenance to display in the Status-Page Url
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(
                page,
                `#btnCreateStatusPage_${projectName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', statusPageName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnCreateStatusPage');
            await init.pageWaitForSelector(page, '#statusPagesListContainer', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, `#header-${statusPageName}`, {
                visible: true,
                timeout: init.timeout,
            });

            // To confirm the status-page name.
            let spanElement = await init.pageWaitForSelector(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', componentName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '[data-testId=type_manual]');
            await init.pageWaitForSelector(page, '#description', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#description');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#description', 'My Manual Monitor');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // To confirm the manual monitor is created
            let spanElement = await init.pageWaitForSelector(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should add monitor to status-page',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#viewStatusPage', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addMoreMonitors');
            await init.selectDropdownValue(
                '#monitor-name-0',
                `${componentName} / ${monitorName}`,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#monitor-description-0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#monitor-description-0',
                'Status Page Description'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#manual-monitor-checkbox-0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await init.pageWaitForSelector(page, '#publicStatusPageUrl', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the status-page
            let spanElement = await init.pageWaitForSelector(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#scheduledMaintenance');
            await init.pageWaitForSelector(page, '#addScheduledEventButton', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addScheduledEventButton');

            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', scheduledMaintenanceName);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#description');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#description',
                scheduledMaintenanceDescription
            );
            await init.pageWaitForSelector(page, 'input[name=startDate]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=startDate]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );
            await init.pageWaitForSelector(
                page,
                'div.MuiDialogActions-root button:nth-child(2)',
                { hidden: true }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=endDate]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.MuiPickersDay-daySelected'); // To select the current date but pick the last hour
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                'span.MuiTypography-body1:nth-child(14)'
            ); // This selects '11'
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                'span.MuiPickersClockNumber-clockNumber:nth-child(15)'
            ); // This selects '55'. 11:55 is the highest possible value from the clock library html elements
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                'div.MuiDialogActions-root button:nth-child(2)'
            );
            await init.pageWaitForSelector(
                page,
                'div.MuiDialogActions-root button:nth-child(2)',
                { hidden: true }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createScheduledEventButton');
            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                hidden: true,
            });
            // This is to confirm that the created scheduled maintenance is present and monitor is there.
            let scheduledMaintenance = await init.pageWaitForSelector(
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should view scheduled maintenance details in status-page',
        async (done: $TSFixMe) => {
            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#viewStatusPage', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');

            await init.pageWaitForSelector(page, '#publicStatusPageUrl', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm scheduled maintenance name
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
