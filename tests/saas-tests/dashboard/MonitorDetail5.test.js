const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const newMonitorName = utils.generateRandomString();
const urlMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

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
    });

    afterAll(async done => {
        await browser.close();
        done();
    });
    test(
        'Should navigate to monitor details and get list of website scans',
        async done => {
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#cbMonitors');
            await init.pageClick(page, '#newFormId');
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.page$Eval(page, 'input[id=name]', e => e.click());
            await init.pageType(page, 'input[id=name]', urlMonitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#url', e => e.click());
            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', e => e.click());

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

    test(
        'Should navigate to monitor details and add new site url',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#addSiteUrl_${urlMonitorName}`
            );
            await init.page$Eval(page, `#addSiteUrl_${urlMonitorName}`, e =>
                e.click()
            );

            await init.pageWaitForSelector(page, 'input[id=siteUrl]');
            await init.pageType(
                page,
                'input[id=siteUrl]',
                'https://oneuptime.com'
            );
            await init.page$Eval(page, '#addSiteUrlButton', e => e.click());

            await init.pageWaitForSelector(page, '#addSiteUrlButton', {
                hidden: true,
            });

            const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
            await init.pageWaitForSelector(page, createdLighthouseLogsSelector);

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

    test(
        'Should navigate to monitor details and remove site url',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#removeSiteUrl_${urlMonitorName}_0`
            );
            await init.page$Eval(
                page,
                `#removeSiteUrl_${urlMonitorName}_0`,
                e => e.click()
            );
            await init.pageWaitForSelector(page, '#websiteUrlDelete');
            await init.page$Eval(page, '#websiteUrlDelete', e => e.click());

            await init.pageWaitForSelector(page, '#websiteUrlDelete', {
                hidden: true,
            });

            const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
            await init.pageWaitForSelector(page, createdLighthouseLogsSelector);

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

    test(
        'Should navigate to monitor details and edit monitor',
        async done => {
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
            await init.page$Eval(page, editButtonSelector, e => e.click());

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]', { clickCount: 3 });
            await init.pageType(page, 'input[id=name]', newMonitorName);
            await init.page$Eval(page, 'button[type=submit]', e => e.click());
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                hidden: true,
            });

            const selector = `#monitor-title-${newMonitorName}`;

            let spanElement = await init.pageWaitForSelector(page, selector);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            spanElement.should.be.exactly(newMonitorName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and delete monitor',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                newMonitorName,
                page
            );
            // click on advanced tab
            await init.pageClick(page, '.advanced-options-tab');

            const deleteButtonSelector = `#delete_${newMonitorName}`;
            await init.page$Eval(page, deleteButtonSelector, e => e.click());

            const confirmDeleteButtonSelector = '#deleteMonitor';
            await init.pageWaitForSelector(page, confirmDeleteButtonSelector);
            await init.page$Eval(page, confirmDeleteButtonSelector, e =>
                e.click()
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
