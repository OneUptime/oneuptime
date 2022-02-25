import utils from '../../test-utils'
import puppeteer from 'puppeteer'
import init from '../../test-init'

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
const subscriberEmail = utils.generateRandomBusinessEmail();
const customDomainWebsite = `www.${utils.generateRandomString()}.com`;

describe('Status-Page Advanced Options', () => {
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
            await init.growthPlanUpgrade(page); // Only Monthly growth plan can enable subscribers in status-page

            // Create a Status-Page and Scheduled Maintenance to display in the Status-Page Url
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(
                page,
                `#btnCreateStatusPage_${projectName}`
            );
            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await init.pageWaitForSelector(page, '#name');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', statusPageName);
            await init.pageClick(page, '#btnCreateStatusPage');
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            await init.pageWaitForSelector(page, '#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, `#header-${statusPageName}`);

            // To confirm the status-page name.
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

    test(
        'should create a manual monitor',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', el => el.click());

            // Fill and submit New Component form
            await init.pageWaitForSelector(page, '#form-new-component');
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
            await init.pageWaitForSelector(page, '#description');
            await init.pageClick(page, '#description');
            await init.pageType(page, '#description', 'My Manual Monitor');
            await init.pageClick(page, 'button[type=submit]');

            // To confirm the manual monitor is created.
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

    test(
        'should add monitor to status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            await init.pageWaitForSelector(page, '#viewStatusPage');
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

            await init.pageWaitForSelector(page, '#publicStatusPageUrl');
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the status-page.
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

    test(
        'should add subscriber',
        async done => {
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
            await init.page$$Eval(page, '.subscribers-tab', elems =>
                elems[0].click()
            );
            await init.pageWaitForSelector(page, '#addSubscriberButton');
            await init.pageClick(page, '#addSubscriberButton');
            await init.pageWaitForSelector(page, '#alertViaId');
            await init.selectDropdownValue('#alertViaId', 'Email', page);
            await init.pageWaitForSelector(page, '#emailId');
            await init.pageClick(page, '#emailId');
            await init.pageType(page, '#emailId', subscriberEmail);
            await init.pageWaitForSelector(page, '#createSubscriber');
            await init.pageClick(page, '#createSubscriber');
            // To confirm that the subscriber is created.
            const subscriberContact = await init.pageWaitForSelector(
                page,
                '#subscriber_contact'
            );
            expect(subscriberContact).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should view created subscriber on status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            await init.pageWaitForSelector(page, '#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            await init.pageWaitForSelector(page, '.subscribers-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.subscribers-tab', elems =>
                elems[0].click()
            );
            // To confirm that the subscriber created is present.
            const subscriberContact = await init.pageWaitForSelector(
                page,
                '#subscriber_contact'
            );
            expect(subscriberContact).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should create custom domain in status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            await init.pageWaitForSelector(page, '#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to custom domain tab in status-page.
            await init.pageWaitForSelector(page, '.custom-domains-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.custom-domains-tab', elems =>
                elems[0].click()
            );
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#customDomain');
            await init.pageClick(page, '#customDomain');
            await init.pageType(page, '#customDomain', customDomainWebsite);
            await init.pageClick(page, '#createCustomDomainBtn');
            // To confirm that custom domain is created.
            const customDomain = await init.pageWaitForSelector(
                page,
                '#publicStatusPageUrl'
            );
            expect(customDomain).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should enable add subscriber from advanced options and view on status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            await init.pageWaitForSelector(page, '#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in status-page
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.advanced-options-tab', elems =>
                elems[0].click()
            );
            // Add Enable Subscribers
            await init.pageClick(page, '#enable-subscribers');
            await init.pageClick(page, '#saveAdvancedOptions');

            await init.pageWaitForSelector(page, '#publicStatusPageUrl');
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            // To confirm subscribe button is present in status-page
            const subscriberButton = await init.pageWaitForSelector(
                page,
                '#subscriber-button'
            );
            expect(subscriberButton).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should navigate to status-page and add subscriber',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.navigateToStatusPage(page);
            await init.pageWaitForSelector(page, '#subscriber-button', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#subscriber-button');
            await init.pageWaitForSelector(page, 'input[name=email]');
            await init.pageClick(page, 'input[name=email]');
            await init.pageType(page, 'input[name=email]', subscriberEmail);
            await init.pageClick(page, '#subscribe-btn-email');
            // To confirm successful subscription
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

    test(
        'should delete status-page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');
            await init.pageClick(page, '#statusPages');
            await init.pageWaitForSelector(page, '#statusPagesListContainer');
            await init.pageWaitForSelector(page, '#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in status-page
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(page, '.advanced-options-tab', elems =>
                elems[0].click()
            );

            await init.pageWaitForSelector(page, '#delete');
            await init.pageClick(page, '#delete');
            await init.pageWaitForSelector(page, '#confirmDelete');
            await init.pageClick(page, '#confirmDelete');

            // To confirm status-page has been deleted.
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
