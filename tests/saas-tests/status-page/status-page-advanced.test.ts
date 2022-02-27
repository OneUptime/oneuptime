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
const subscriberEmail = utils.generateRandomBusinessEmail();
const customDomainWebsite = `www.${utils.generateRandomString()}.com`;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Status-Page Advanced Options', () => {
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
            await init.growthPlanUpgrade(page); // Only Monthly growth plan can enable subscribers in status-page

            // Create a Status-Page and Scheduled Maintenance to display in the Status-Page Url
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#btnCreateStatusPage_${projectName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#name');
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#header-${statusPageName}`);

            // To confirm the status-page name.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#header-${statusPageName}`
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

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (el: $TSFixMe) =>
                el.click()
            );

            // Fill and submit New Component form
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-component');
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#description');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#description');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#description', 'My Manual Monitor');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // To confirm the manual monitor is created.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
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

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
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

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the status-page.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-${monitorName}`
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
        'should add subscriber',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // Navigate to subscriber tab in monitor.
            await init.pageWaitForSelector(page, '.subscribers-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.subscribers-tab', (elems: $TSFixMe) =>
                elems[0].click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#alertViaId');
            await init.selectDropdownValue('#alertViaId', 'Email', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#emailId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#emailId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#emailId', subscriberEmail);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#createSubscriber');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createSubscriber');
            // To confirm that the subscriber is created.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const subscriberContact = await init.pageWaitForSelector(
                page,
                '#subscriber_contact'
            );
            expect(subscriberContact).toBeDefined();

            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should view created subscriber on status-page',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, '.subscribers-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.subscribers-tab', (elems: $TSFixMe) =>
                elems[0].click()
            );
            // To confirm that the subscriber created is present.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const subscriberContact = await init.pageWaitForSelector(
                page,
                '#subscriber_contact'
            );
            expect(subscriberContact).toBeDefined();

            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create custom domain in status-page',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to custom domain tab in status-page.
            await init.pageWaitForSelector(page, '.custom-domains-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.custom-domains-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addMoreDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addMoreDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#customDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#customDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#customDomain', customDomainWebsite);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createCustomDomainBtn');
            // To confirm that custom domain is created.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const customDomain = await init.pageWaitForSelector(
                page,
                '#publicStatusPageUrl'
            );
            expect(customDomain).toBeDefined();

            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should enable add subscriber from advanced options and view on status-page',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in status-page
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            // Add Enable Subscribers
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#enable-subscribers');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#saveAdvancedOptions');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            // To confirm subscribe button is present in status-page
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const subscriberButton = await init.pageWaitForSelector(
                page,
                '#subscriber-button'
            );
            expect(subscriberButton).toBeDefined();

            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should navigate to status-page and add subscriber',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.navigateToStatusPage(page);
            await init.pageWaitForSelector(page, '#subscriber-button', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#subscriber-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=email]', subscriberEmail);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#subscribe-btn-email');
            // To confirm successful subscription
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let subscribeSuccess = await init.pageWaitForSelector(
                page,
                '#monitor-subscribe-success-message'
            );
            subscribeSuccess = await subscribeSuccess.getProperty('innerText');
            subscribeSuccess = await subscribeSuccess.jsonValue();
            expect(subscribeSuccess).toMatch(
                'You have subscribed to this status page successfully'
            );

            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete status-page',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#viewStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in status-page
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#delete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#delete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#confirmDelete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#confirmDelete');

            // To confirm status-page has been deleted.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const deletedStatusPage = await init.pageWaitForSelector(
                page,
                '#statusPagesListContainer'
            );
            expect(deletedStatusPage).toBeDefined();

            done();
        },
        init.timeout
    );
});
