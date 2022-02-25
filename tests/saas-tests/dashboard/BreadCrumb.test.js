import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user = {
    email,
    password,
};

describe('BreadCrumb Component test', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should navigate between pages from the breadcrumbs',
        async done => {
            const componentName = utils.generateRandomString();
            const monitorName = utils.generateRandomString();

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.addMonitorToComponent(componentName, monitorName, page);

            const monitorBreadcrumb = await init.pageWaitForSelector(
                page,
                `#cb${monitorName}`,
                {
                    visible: true,
                }
            );
            const componentBreadcrumb = await init.pageWaitForSelector(
                page,
                '#cbMonitors'
            );
            expect(monitorBreadcrumb).toBeDefined();
            expect(componentBreadcrumb).toBeDefined();
            await init.pageClick(page, '#cbMonitors');

            const monitorTitle = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(monitorTitle).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not go to the landing page when the project breadcrumb item is clicked',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#cbUnnamedProject', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#cbUnnamedProject');
            let currentPage = await init.pageWaitForSelector(
                page,
                '#cbUnnamedProject',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            currentPage = await currentPage.getProperty('innerText');
            currentPage = await currentPage.jsonValue();
            expect(currentPage).toBe('Unnamed Project');

            done();
        },
        operationTimeOut
    );
});
