// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const newMonitorName = utils.generateRandomString();
const urlMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Monitor Detail API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
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
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and get list of website scans',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#newFormId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.page$Eval(page, 'input[id=name]', (e: $TSFixMe) =>
                e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', urlMonitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#url', (e: $TSFixMe) => e.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );

            //Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
            await init.pageWaitForSelector(
                page,
                createdLighthouseLogsSelector,
                {
                    visible: true,
                    timeout: 200000,
                }
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const lighthouseLogsRows = await init.page$$(
                page,
                createdLighthouseLogsSelector
            );
            const countLighthouseLogs = lighthouseLogsRows.length;

            expect(countLighthouseLogs).toEqual(1);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and add new site url',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#addSiteUrl_${urlMonitorName}`
            );
            await init.page$Eval(
                page,
                `#addSiteUrl_${urlMonitorName}`,
                (e: $TSFixMe) => e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[id=siteUrl]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[id=siteUrl]',
                'https://oneuptime.com'
            );
            await init.page$Eval(page, '#addSiteUrlButton', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#addSiteUrlButton', {
                hidden: true,
            });

            const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdLighthouseLogsSelector);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const lighthouseLogsRows = await init.page$$(
                page,
                createdLighthouseLogsSelector
            );
            const countLighthouseLogs = lighthouseLogsRows.length;

            expect(countLighthouseLogs).toEqual(2);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and remove site url',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#removeSiteUrl_${urlMonitorName}_0`
            );
            await init.page$Eval(
                page,
                `#removeSiteUrl_${urlMonitorName}_0`,
                (e: $TSFixMe) => e.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#websiteUrlDelete');
            await init.page$Eval(page, '#websiteUrlDelete', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#websiteUrlDelete', {
                hidden: true,
            });

            const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdLighthouseLogsSelector);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const lighthouseLogsRows = await init.page$$(
                page,
                createdLighthouseLogsSelector
            );
            const countLighthouseLogs = lighthouseLogsRows.length;

            expect(countLighthouseLogs).toEqual(1);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and edit monitor',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            const editButtonSelector = `#edit_${monitorName}`;
            await init.pageWaitForSelector(page, editButtonSelector, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, editButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]', { clickCount: 3 });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', newMonitorName);
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                hidden: true,
            });

            const selector = `#monitor-title-${newMonitorName}`;

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(page, selector);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            spanElement.should.be.exactly(newMonitorName);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and delete monitor',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                newMonitorName,
                page
            );
            // click on advanced tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.advanced-options-tab');

            const deleteButtonSelector = `#delete_${newMonitorName}`;
            await init.page$Eval(page, deleteButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            const confirmDeleteButtonSelector = '#deleteMonitor';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, confirmDeleteButtonSelector);
            await init.page$Eval(
                page,
                confirmDeleteButtonSelector,
                (e: $TSFixMe) => e.click()
            );
            await init.pageWaitForSelector(page, confirmDeleteButtonSelector, {
                hidden: true,
            });

            const selector = `span#monitor-title-${newMonitorName}`;

            const spanElement = await init.page$(page, selector, {
                hidden: true,
            });
            expect(spanElement).toEqual(null);
            done();
        },
        operationTimeOut
    );
    // Tests Split
});
