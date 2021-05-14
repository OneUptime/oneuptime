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

            await page.waitForSelector('#statusPages');
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
            await init.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#name');
            await page.waitForSelector('input[id=name]', { visible: true, timeout: init.timeout });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', statusPageName);
            await init.pageClick(page, '#btnCreateStatusPage');
            await page.waitForSelector('#statusPagesListContainer');
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector(`#header-${statusPageName}`);

            // To confirm the status-page name.
            let spanElement = await page.waitForSelector(
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

            await page.waitForSelector('#components');
            await page.$eval('#components', el => el.click());

            // Fill and submit New Component form
            await page.waitForSelector('#form-new-component');
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
            await page.waitForSelector('#description');
            await init.pageClick(page, '#description');
            await init.pageType(page, '#description', 'My Manual Monitor');
            await init.pageClick(page, 'button[type=submit]');

            // To confirm the manual monitor is created.
            let spanElement = await page.waitForSelector(
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

            await page.waitForSelector('#statusPages');
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer');
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector('#addMoreMonitors');
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

            await page.waitForSelector('#publicStatusPageUrl');
            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the status-page.
            let spanElement = await page.waitForSelector(
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
            await page.waitForSelector('.subscribers-tab', {
                visible: true,
            });
            await page.$$eval('.subscribers-tab', elems => elems[0].click());
            await page.waitForSelector('#addSubscriberButton');
            await init.pageClick(page, '#addSubscriberButton');
            await page.waitForSelector('#alertViaId');
            await init.selectByText('#alertViaId', 'Email', page);
            await page.waitForSelector('#emailId');
            await init.pageClick(page, '#emailId');
            await init.pageType(page, '#emailId', subscriberEmail);
            await page.waitForSelector('#createSubscriber');
            await init.pageClick(page, '#createSubscriber');
            // To confirm that the subscriber is created.
            const subscriberContact = await page.waitForSelector(
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

            await page.waitForSelector('#statusPages');
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer');
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            await page.waitForSelector('.subscribers-tab', {
                visible: true,
            });
            await page.$$eval('.subscribers-tab', elems => elems[0].click());
            // To confirm that the subscriber created is present.
            const subscriberContact = await page.waitForSelector(
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

            await page.waitForSelector('#statusPages');
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer');
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to custom domain tab in status-page.
            await page.waitForSelector('.custom-domains-tab', {
                visible: true,
            });
            await page.$$eval('.custom-domains-tab', elems => elems[0].click());
            await page.waitForSelector('#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await page.waitForSelector('#customDomain');
            await init.pageClick(page, '#customDomain');
            await init.pageType(page, '#customDomain', customDomainWebsite);
            await init.pageClick(page, '#createCustomDomainBtn');
            // To confirm that custom domain is created.
            const customDomain = await page.waitForSelector(
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

            await page.waitForSelector('#statusPages');
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer');
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in status-page
            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );
            // Add Enable Subscribers
            await init.pageClick(page, '#enable-subscribers');
            await init.pageClick(page, '#saveAdvancedOptions');

            await page.waitForSelector('#publicStatusPageUrl');
            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            // To confirm subscribe button is present in status-page
            const subscriberButton = await page.waitForSelector(
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
            await page.waitForSelector('#subscriber-button');
            await init.pageClick(page, '#subscriber-button');
            await page.waitForSelector('input[name=email]');
            await init.pageClick(page, 'input[name=email]');
            await init.pageType(page, 'input[name=email]', subscriberEmail);
            await init.pageClick(page, '#subscribe-btn-email');
            // To confirm successful subscription
            let subscribeSuccess = await page.waitForSelector(
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

            await page.waitForSelector('#statusPages');
            await init.pageClick(page, '#statusPages');
            await page.waitForSelector('#statusPagesListContainer');
            await page.waitForSelector('#viewStatusPage');
            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in status-page
            await page.waitForSelector('.advanced-options-tab', {
                visible: true,
            });
            await page.$$eval('.advanced-options-tab', elems =>
                elems[0].click()
            );

            await page.waitForSelector('#delete');
            await init.pageClick(page, '#delete');
            await page.waitForSelector('#confirmDelete');
            await init.pageClick(page, '#confirmDelete');

            // To confirm status-page has been deleted.
            const deletedStatusPage = await page.waitForSelector(
                '#statusPagesListContainer'
            );
            expect(deletedStatusPage).toBeDefined();

            done();
        },
        init.timeout
    );
});
