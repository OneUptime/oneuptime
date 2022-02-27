// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Monitor API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(600000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);
        await init.addMonitorToComponent(componentName, monitorName, page); // This creates a default component and a monitor. The monitor created here will be used by other tests as required
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should display lighthouse scores', async (done: $TSFixMe) => {
        // Navigate to Component details
        // This navigates to the monitor created alongside the created component
        await init.navigateToMonitorDetails(componentName, monitorName, page);

        await init.pageWaitForSelector(page, '#website_scanning', {
            timeout: 600000,
        });
        await init.pageWaitForSelector(page, '#website_postscan', {
            timeout: 600000,
        });

        await init.pageWaitForSelector(
            page,
            `#lighthouseLogs_${monitorName}_0`,
            {
                visible: true,
                timeout: 600000,
            }
        );

        let lighthousePerformanceElement = await init.pageWaitForSelector(
            page,
            `#lighthouse-performance-${monitorName}`,
            { visible: true, timeout: 600000 }
        );
        lighthousePerformanceElement = await lighthousePerformanceElement.getProperty(
            'innerText'
        );
        lighthousePerformanceElement = await lighthousePerformanceElement.jsonValue();
        lighthousePerformanceElement.should.endWith('%');

        let lighthouseAccessibilityElement = await init.pageWaitForSelector(
            page,
            `#lighthouse-accessibility-${monitorName}`,
            { visible: true, timeout: operationTimeOut }
        );
        lighthouseAccessibilityElement = await lighthouseAccessibilityElement.getProperty(
            'innerText'
        );
        lighthouseAccessibilityElement = await lighthouseAccessibilityElement.jsonValue();
        lighthouseAccessibilityElement.should.endWith('%');

        let lighthouseBestPracticesElement = await init.pageWaitForSelector(
            page,
            `#lighthouse-bestPractices-${monitorName}`,
            { visible: true, timeout: operationTimeOut }
        );
        lighthouseBestPracticesElement = await lighthouseBestPracticesElement.getProperty(
            'innerText'
        );
        lighthouseBestPracticesElement = await lighthouseBestPracticesElement.jsonValue();
        lighthouseBestPracticesElement.should.endWith('%');

        let lighthouseSeoElement = await init.pageWaitForSelector(
            page,
            `#lighthouse-seo-${monitorName}`,
            { visible: true, timeout: operationTimeOut }
        );
        lighthouseSeoElement = await lighthouseSeoElement.getProperty(
            'innerText'
        );
        lighthouseSeoElement = await lighthouseSeoElement.jsonValue();
        lighthouseSeoElement.should.endWith('%');

        let lighthousePwaElement = await init.pageWaitForSelector(
            page,
            `#lighthouse-pwa-${monitorName}`,
            { visible: true, timeout: operationTimeOut }
        );
        lighthousePwaElement = await lighthousePwaElement.getProperty(
            'innerText'
        );
        lighthousePwaElement = await lighthousePwaElement.jsonValue();
        lighthousePwaElement.should.endWith('%');
        done();
    }, 600000);

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should display multiple probes and monitor chart on refresh',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            // This navigates to the monitor created alongside the created component
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const probe0 = await init.pageWaitForSelector(page, '#probes-btn0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const probe1 = await init.pageWaitForSelector(page, '#probes-btn1');

            expect(probe0).toBeDefined();
            expect(probe1).toBeDefined();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const monitorStatus = await init.pageWaitForSelector(
                page,
                `#monitor-status-${monitorName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const sslStatus = await init.pageWaitForSelector(
                page,
                `#ssl-status-${monitorName}`
            );

            expect(monitorStatus).toBeDefined();
            expect(sslStatus).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
