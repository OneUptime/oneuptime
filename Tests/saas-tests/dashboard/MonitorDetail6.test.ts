import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const urlMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(600000);

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
        await init.addMonitorToComponent(componentName, urlMonitorName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test('Should navigate to monitor details and trigger website scan', async (done: $TSFixMe) => {
        // Navigate to Monitor details
        await init.navigateToMonitorDetails(
            componentName,
            urlMonitorName,
            page
        );
        init.pageWaitForSelector(page, `#ssl-status-${urlMonitorName}`, {
            timeout: 600000,
        });
        await init.pageWaitForSelector(
            page,
            `#lighthouse-performance-${urlMonitorName}`,
            { visible: true, timeout: 600000 }
        );

        await init.pageWaitForSelector(page, '#website_postscan');

        await init.pageWaitForSelector(page, `#scanWebsites_${urlMonitorName}`);
        await init.page$Eval(
            page,
            `#scanWebsites_${urlMonitorName}`,
            (e: $TSFixMe) => e.click()
        );

        await init.pageWaitForSelector(page, '#website_prescan');
        await init.pageWaitForSelector(page, '#website_scanning', {
            timeout: 600000,
        });
        await init.pageWaitForSelector(page, '#website_postscan', {
            timeout: 600000,
        });
        let lighthousePerformanceElement = await init.pageWaitForSelector(
            page,
            `#performance_${urlMonitorName}_0`,
            { visible: true, timeout: init.timeout }
        );
        lighthousePerformanceElement =
            await lighthousePerformanceElement.getProperty('innerText');
        lighthousePerformanceElement =
            await lighthousePerformanceElement.jsonValue();
        lighthousePerformanceElement.should.endWith('%');
        done();
    }, 600000);

    test(
        'should display multiple probes and monitor chart on refresh',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            await page.reload({
                waitUntil: ['networkidle0', 'domcontentloaded'],
            });

            const probe0 = await init.pageWaitForSelector(page, '#probes-btn0');

            const probe1 = await init.pageWaitForSelector(page, '#probes-btn1');

            expect(probe0).toBeDefined();
            expect(probe1).toBeDefined();

            const monitorStatus = await init.pageWaitForSelector(
                page,
                `#monitor-status-${urlMonitorName}`,
                { visible: true, timeout: operationTimeOut }
            );
            const sslStatus = await init.pageWaitForSelector(
                page,
                `#ssl-status-${urlMonitorName}`,
                { visible: true, timeout: operationTimeOut }
            );

            expect(monitorStatus).toBeDefined();
            expect(sslStatus).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get lighthouse scores and website issues',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                urlMonitorName,
                page
            );

            await init.pageWaitForSelector(page, '#website_postscan');

            let lighthousePerformanceElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-performance-${urlMonitorName}`,
                { visible: true, timeout: init.timeout }
            );
            lighthousePerformanceElement =
                await lighthousePerformanceElement.getProperty('innerText');
            lighthousePerformanceElement =
                await lighthousePerformanceElement.jsonValue();
            lighthousePerformanceElement.should.endWith('%');

            let lighthouseAccessibilityElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-accessibility-${urlMonitorName}`,
                { visible: true, timeout: init.timeout }
            );
            lighthouseAccessibilityElement =
                await lighthouseAccessibilityElement.getProperty('innerText');
            lighthouseAccessibilityElement =
                await lighthouseAccessibilityElement.jsonValue();
            lighthouseAccessibilityElement.should.endWith('%');

            let lighthouseBestPracticesElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-bestPractices-${urlMonitorName}`,
                { visible: true, timeout: init.timeout }
            );
            lighthouseBestPracticesElement =
                await lighthouseBestPracticesElement.getProperty('innerText');
            lighthouseBestPracticesElement =
                await lighthouseBestPracticesElement.jsonValue();
            lighthouseBestPracticesElement.should.endWith('%');

            let lighthouseSeoElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-seo-${urlMonitorName}`,
                { visible: true, timeout: init.timeout }
            );
            lighthouseSeoElement = await lighthouseSeoElement.getProperty(
                'innerText'
            );
            lighthouseSeoElement = await lighthouseSeoElement.jsonValue();
            lighthouseSeoElement.should.endWith('%');

            let lighthousePwaElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-pwa-${urlMonitorName}`,
                { visible: true, timeout: init.timeout }
            );
            lighthousePwaElement = await lighthousePwaElement.getProperty(
                'innerText'
            );
            lighthousePwaElement = await lighthousePwaElement.jsonValue();
            lighthousePwaElement.should.endWith('%');

            await init.pageClick(page, `#lighthouseUrl_${urlMonitorName}_0`);

            const websiteIssuesSelector =
                '#performance #websiteIssuesList > tbody >tr.websiteIssuesListItem';

            await init.pageWaitForSelector(page, websiteIssuesSelector);

            const websiteIssuesRows = await init.page$$(
                page,
                websiteIssuesSelector
            );
            const countWebsiteIssues = websiteIssuesRows.length;

            expect(countWebsiteIssues).toBeGreaterThanOrEqual(1);
            done();
        },
        operationTimeOut
    );
});
