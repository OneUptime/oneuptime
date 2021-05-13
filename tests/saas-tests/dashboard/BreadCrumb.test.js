const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
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

            const monitorBreadcrumb = await page.waitForSelector(
                `#cb${monitorName}`,
                {
                    visible: true,
                }
            );
            const componentBreadcrumb = await page.waitForSelector(
                '#cbMonitors'
            );
            expect(monitorBreadcrumb).toBeDefined();
            expect(componentBreadcrumb).toBeDefined();
            await init.pageClick(page, '#cbMonitors');

            const monitorTitle = await page.waitForSelector(
                `#monitor-title-${monitorName}`,
                { visible: true }
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
            await page.waitForSelector('#cbUnnamedProject', { visible: true });
            await init.pageClick(page, '#cbUnnamedProject');
            let currentPage = await page.waitForSelector('#cbUnnamedProject', {
                visible: true,
            });
            currentPage = await currentPage.getProperty('innerText');
            currentPage = await currentPage.jsonValue();
            expect(currentPage).toBe('Unnamed Project');

            done();
        },
        operationTimeOut
    );
});
