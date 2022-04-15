import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const monitorName: string = utils.generateRandomString();
const newMonitorName: string = utils.generateRandomString();
const urlMonitorName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user: $TSFixMe = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);
        // add new monitor to component on parent project
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should navigate to monitor details and get list of website scans',
        async (done: $TSFixMe) => {
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#cbMonitors');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.page$Eval(page, 'input[id=name]', (e: $TSFixMe) => {
                return e.click();
            });

            await init.pageType(page, 'input[id=name]', urlMonitorName);

            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#url', (e: $TSFixMe) => {
                return e.click();
            });

            await init.pageType(page, '#url', 'https://google.com');
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) => {
                return e.click();
            });

            //Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            const createdLighthouseLogsSelector: string =
                '.lighthouseLogsListItem';
            await init.pageWaitForSelector(
                page,
                createdLighthouseLogsSelector,
                {
                    visible: true,
                    timeout: 200000,
                }
            );

            const lighthouseLogsRows: $TSFixMe = await init.page$$(
                page,
                createdLighthouseLogsSelector
            );
            const countLighthouseLogs: $TSFixMe = lighthouseLogsRows.length;

            expect(countLighthouseLogs).toEqual(1);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and add new site url',
        async (done: $TSFixMe) => {
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
            await init.page$Eval(
                page,
                `#addSiteUrl_${urlMonitorName}`,
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            await init.pageWaitForSelector(page, 'input[id=siteUrl]');

            await init.pageType(
                page,
                'input[id=siteUrl]',
                'https://oneuptime.com'
            );
            await init.page$Eval(page, '#addSiteUrlButton', (e: $TSFixMe) => {
                return e.click();
            });

            await init.pageWaitForSelector(page, '#addSiteUrlButton', {
                hidden: true,
            });

            const createdLighthouseLogsSelector: string =
                '.lighthouseLogsListItem';

            await init.pageWaitForSelector(page, createdLighthouseLogsSelector);

            const lighthouseLogsRows: $TSFixMe = await init.page$$(
                page,
                createdLighthouseLogsSelector
            );
            const countLighthouseLogs: $TSFixMe = lighthouseLogsRows.length;

            expect(countLighthouseLogs).toEqual(2);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and remove site url',
        async (done: $TSFixMe) => {
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
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            await init.pageWaitForSelector(page, '#websiteUrlDelete');
            await init.page$Eval(page, '#websiteUrlDelete', (e: $TSFixMe) => {
                return e.click();
            });

            await init.pageWaitForSelector(page, '#websiteUrlDelete', {
                hidden: true,
            });

            const createdLighthouseLogsSelector: string =
                '.lighthouseLogsListItem';

            await init.pageWaitForSelector(page, createdLighthouseLogsSelector);

            const lighthouseLogsRows: $TSFixMe = await init.page$$(
                page,
                createdLighthouseLogsSelector
            );
            const countLighthouseLogs: $TSFixMe = lighthouseLogsRows.length;

            expect(countLighthouseLogs).toEqual(1);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and edit monitor',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            const editButtonSelector: string = `#edit_${monitorName}`;
            await init.pageWaitForSelector(page, editButtonSelector, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, editButtonSelector, (e: $TSFixMe) => {
                return e.click();
            });

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageClick(page, 'input[id=name]', { clickCount: 3 });

            await init.pageType(page, 'input[id=name]', newMonitorName);
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) => {
                return e.click();
            });
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                hidden: true,
            });

            const selector: string = `#monitor-title-${newMonitorName}`;

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                selector
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            spanElement.should.be.exactly(newMonitorName);
            done();
        },
        operationTimeOut
    );

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

            await init.pageClick(page, '.advanced-options-tab');

            const deleteButtonSelector: string = `#delete_${newMonitorName}`;
            await init.page$Eval(page, deleteButtonSelector, (e: $TSFixMe) => {
                return e.click();
            });

            const confirmDeleteButtonSelector: string = '#deleteMonitor';

            await init.pageWaitForSelector(page, confirmDeleteButtonSelector);
            await init.page$Eval(
                page,
                confirmDeleteButtonSelector,
                (e: $TSFixMe) => {
                    return e.click();
                }
            );
            await init.pageWaitForSelector(page, confirmDeleteButtonSelector, {
                hidden: true,
            });

            const selector: string = `span#monitor-title-${newMonitorName}`;

            const spanElement: $TSFixMe = await init.page$(page, selector, {
                hidden: true,
            });
            expect(spanElement).toEqual(null);
            done();
        },
        operationTimeOut
    );
    // Tests Split
});
