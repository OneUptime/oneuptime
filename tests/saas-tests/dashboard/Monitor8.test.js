const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
require('should');

// user credentials
const password = '1234567890';

describe('API Monitor API', () => {
    const operationTimeOut = init.timeout;

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
        await page.evaluate(
            () => (document.getElementById('responseTime').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('statusCode').value = '')
        );
        await page.evaluate(
            () => (document.getElementById('header').value = '')
        );
        await page.evaluate(() => (document.getElementById('body').value = ''));
        await init.pageWaitForSelector(page, '#responseTime');
        await init.pageClick(page, 'input[name=responseTime]');
        await init.pageType(page, 'input[name=responseTime]', '0');
        await init.pageWaitForSelector(page, '#statusCode');
        await init.pageClick(page, 'input[name=statusCode]');
        await init.pageType(page, 'input[name=statusCode]', '200');
        await page.select('#responseType', 'json');
        await init.pageWaitForSelector(page, '#header');
        await init.pageClick(page, 'textarea[name=header]');
        await init.pageType(
            page,
            'textarea[name=header]',
            '{"Content-Type":"application/json"}'
        );
        await init.pageWaitForSelector(page, '#body');
        await init.pageClick(page, 'textarea[name=body]');
        await init.pageType(page, 'textarea[name=body]', '{"status":"ok"}');
        await init.pageClick(page, 'button[type=submit]');
        await init.pageWaitForSelector(page, '#save-btn');
        await init.pageWaitForSelector(page, '#save-btn', {
            visible: true,
            timeout: init.timeout,
        });

        const user = {
            email: utils.generateRandomBusinessEmail(),
            password,
        };
        await init.registerUser(user, page);

        await init.addComponent(componentName, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not add API monitor with invalid url',
        async done => {
            // Create Component first
            // Redirects automatically component to details page
            await init.navigateToComponentDetails(componentName, page);
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.selectDropdownValue('#method', 'get', page);

            await init.pageClick(page, 'button[type=submit]');

            let spanElement = await init.pageWaitForSelector(
                page,
                '#formNewMonitorError'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(
                'API Monitor URL should not be a HTML page.'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'should not add API monitor with invalid payload',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(
                page,
                '#url',
                'https://oneuptime.com/api/monitor/valid-project-id'
            );
            await init.selectDropdownValue('#method', 'post', page);

            await init.pageClick(page, 'button[type=submit]');

            const spanElement = await init.pageWaitForSelector(
                page,
                '#formNewMonitorError'
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add API monitor with invalid payload in advance options',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.selectDropdownValue('#method', 'post', page);
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(
                page,
                '#url',
                'https://oneuptime.com/api/monitor/valid-project-id'
            );
            await init.pageWaitForSelector(page, '#advanceOptions');
            await init.pageClick(page, '#advanceOptions');

            await init.pageWaitForSelector(page, '#addApiHeaders');
            await init.pageClick(page, '#addApiHeaders');
            await init.pageWaitForSelector(
                page,
                'input[id=headers_1000_0_key]'
            );
            await init.pageClick(page, 'input[id=headers_1000_0_key]');
            await init.pageType(
                page,
                'input[id=headers_1000_0_key]',
                'Authorization'
            );
            await init.pageClick(page, 'input[id=headers_1000_0_value]');
            await init.pageType(
                page,
                'input[id=headers_1000_0_value]',
                'Basic valid-token'
            );
            await init.selectDropdownValue('#bodyType', 'text/plain', page);
            await init.pageClick(page, '#feedback-textarea');
            await init.pageType(page, '#feedback-textarea', 'BAD');
            await init.pageClick(page, 'button[type=submit]');

            const spanElement = await init.pageWaitForSelector(
                page,
                '#formNewMonitorError'
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should add API monitor with valid url and payload',
        async done => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, 'input[data-testId=type_api]');
            await init.selectDropdownValue('#method', 'get', page);
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'http://localhost:3002/api');
            await init.pageClick(page, 'button[type=submit]');

            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);
            done();
        },
        operationTimeOut
    );
    // Tests Split
});
