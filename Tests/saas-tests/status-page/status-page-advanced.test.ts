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
const subscriberEmail: Email = utils.generateRandomBusinessEmail();
const customDomainWebsite: string = `www.${utils.generateRandomString()}.com`;

describe('StatusPage Advanced Options', () => {
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
            await init.growthPlanUpgrade(page); // Only Monthly growth plan can enable subscribers in StatusPage

            // Create a StatusPage and Scheduled Maintenance to display in the StatusPage Url
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

            // To confirm the StatusPage name.

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (el: $TSFixMe) => {
                return el.click();
            });

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

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
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
        'should add monitor to StatusPage',
        async (done: $TSFixMe) => {
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

            let link: $TSFixMe = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            // To confirm the monitor is present in the StatusPage.

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
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
            await init.page$$Eval(
                page,
                '.subscribers-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
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

            const subscriberContact: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#subscriber_contact'
            );
            expect(subscriberContact).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should view created subscriber on StatusPage',
        async (done: $TSFixMe) => {
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
            await init.page$$Eval(
                page,
                '.subscribers-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            // To confirm that the subscriber created is present.

            const subscriberContact: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#subscriber_contact'
            );
            expect(subscriberContact).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should create custom domain in StatusPage',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            await init.pageWaitForSelector(page, '#statusPagesListContainer');

            await init.pageWaitForSelector(page, '#viewStatusPage');

            await init.pageClick(page, '#viewStatusPage');
            // Navigate to custom domain tab in StatusPage.
            await init.pageWaitForSelector(page, '.custom-domains-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.custom-domains-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');

            await init.pageWaitForSelector(page, '#customDomain');

            await init.pageClick(page, '#customDomain');

            await init.pageType(page, '#customDomain', customDomainWebsite);

            await init.pageClick(page, '#createCustomDomainBtn');
            // To confirm that custom domain is created.

            const customDomain: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#publicStatusPageUrl'
            );
            expect(customDomain).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should enable add subscriber from advanced options and view on StatusPage',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            await init.pageWaitForSelector(page, '#statusPagesListContainer');

            await init.pageWaitForSelector(page, '#viewStatusPage');

            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in StatusPage
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            // Add Enable Subscribers

            await init.pageClick(page, '#enable-subscribers');

            await init.pageClick(page, '#saveAdvancedOptions');

            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link: $TSFixMe = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            // To confirm subscribe button is present in StatusPage

            const subscriberButton: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#subscriber-button'
            );
            expect(subscriberButton).toBeDefined();

            done();
        },
        init.timeout
    );

    test(
        'should navigate to StatusPage and add subscriber',
        async (done: $TSFixMe) => {
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

            let subscribeSuccess: $TSFixMe = await init.pageWaitForSelector(
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
        'should delete StatusPage',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            await init.pageWaitForSelector(page, '#statusPagesListContainer');

            await init.pageWaitForSelector(page, '#viewStatusPage');

            await init.pageClick(page, '#viewStatusPage');
            // Navigate to advanced tab in StatusPage
            await init.pageWaitForSelector(page, '.advanced-options-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.advanced-options-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );

            await init.pageWaitForSelector(page, '#delete');

            await init.pageClick(page, '#delete');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');

            // To confirm StatusPage has been deleted.

            const deletedStatusPage: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#statusPagesListContainer'
            );
            expect(deletedStatusPage).toBeDefined();

            done();
        },
        init.timeout
    );
});
