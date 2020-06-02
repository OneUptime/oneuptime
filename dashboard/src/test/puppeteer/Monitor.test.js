const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const callSchedule = utils.generateRandomString();

describe('Monitor API', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(100000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            await init.addSchedule(callSchedule, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();
    const callScheduleMonitorName = utils.generateRandomString();

    test(
        'Should create new monitor with correct details',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Create Component first
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'should display lighthouse scores',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                await page.waitFor(280000);

                let lighthousePerformanceElement = await page.waitForSelector(
                    `#lighthouse-performance-${monitorName}`
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.getProperty(
                    'innerText'
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.jsonValue();
                lighthousePerformanceElement.should.endWith('%');

                let lighthouseAccessibilityElement = await page.waitForSelector(
                    `#lighthouse-accessibility-${monitorName}`
                );
                lighthouseAccessibilityElement = await lighthouseAccessibilityElement.getProperty(
                    'innerText'
                );
                lighthouseAccessibilityElement = await lighthouseAccessibilityElement.jsonValue();
                lighthouseAccessibilityElement.should.endWith('%');

                let lighthouseBestPracticesElement = await page.waitForSelector(
                    `#lighthouse-bestPractices-${monitorName}`
                );
                lighthouseBestPracticesElement = await lighthouseBestPracticesElement.getProperty(
                    'innerText'
                );
                lighthouseBestPracticesElement = await lighthouseBestPracticesElement.jsonValue();
                lighthouseBestPracticesElement.should.endWith('%');

                let lighthouseSeoElement = await page.waitForSelector(
                    `#lighthouse-seo-${monitorName}`
                );
                lighthouseSeoElement = await lighthouseSeoElement.getProperty(
                    'innerText'
                );
                lighthouseSeoElement = await lighthouseSeoElement.jsonValue();
                lighthouseSeoElement.should.endWith('%');

                let lighthousePwaElement = await page.waitForSelector(
                    `#lighthouse-pwa-${monitorName}`
                );
                lighthousePwaElement = await lighthousePwaElement.getProperty(
                    'innerText'
                );
                lighthousePwaElement = await lighthousePwaElement.jsonValue();
                lighthousePwaElement.should.endWith('%');
            });
        },
        operationTimeOut
    );

    test(
        'Should create new monitor with call schedule',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.waitForSelector('#name');
                await page.click('input[id=name]');
                await page.type('input[id=name]', callScheduleMonitorName);
                await init.selectByText('#type', 'url', page);
                await init.selectByText('#callSchedule', callSchedule, page);
                await page.waitForSelector('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${callScheduleMonitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(callScheduleMonitorName);
            });
        },
        operationTimeOut
    );

    test(
        'Should not create new monitor when details are incorrect',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                // await page.waitForSelector('#monitors');
                // await page.click('#monitors');
                await page.waitForSelector('#form-new-monitor');
                await page.waitForSelector('#name');
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    '#form-new-monitor span#field-error'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'This field cannot be left blank'
                );
            });
        },
        operationTimeOut
    );

    test(
        'should display SSL enabled status',
        async () => {
            const sslMonitorName = utils.generateRandomString();

            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', sslMonitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');
                await page.waitFor(280000);

                let sslStatusElement = await page.waitForSelector(
                    `#ssl-status-${sslMonitorName}`
                );
                sslStatusElement = await sslStatusElement.getProperty(
                    'innerText'
                );
                sslStatusElement = await sslStatusElement.jsonValue();
                sslStatusElement.should.be.exactly('Enabled');
            });
        },
        operationTimeOut
    );

    test(
        'should display SSL not found status',
        async () => {
            const testServerMonitorName = utils.generateRandomString();

            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', testServerMonitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'http://localhost:3010');
                await page.click('button[type=submit]');
                await page.waitFor(280000);

                let sslStatusElement = await page.waitForSelector(
                    `#ssl-status-${testServerMonitorName}`
                );
                sslStatusElement = await sslStatusElement.getProperty(
                    'innerText'
                );
                sslStatusElement = await sslStatusElement.jsonValue();
                sslStatusElement.should.be.exactly('No SSL Found');
            });
        },
        operationTimeOut
    );

    test(
        'should display SSL self-signed status',
        async () => {
            const selfSignedMonitorName = utils.generateRandomString();

            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', selfSignedMonitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://self-signed.badssl.com');
                await page.click('button[type=submit]');
                await page.waitFor(280000);

                let sslStatusElement = await page.waitForSelector(
                    `#ssl-status-${selfSignedMonitorName}`
                );
                sslStatusElement = await sslStatusElement.getProperty(
                    'innerText'
                );
                sslStatusElement = await sslStatusElement.jsonValue();
                sslStatusElement.should.be.exactly('Self Signed');
            });
        },
        operationTimeOut
    );
});
