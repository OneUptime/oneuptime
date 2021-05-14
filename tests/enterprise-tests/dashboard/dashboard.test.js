const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Enterprise Dashboard API', () => {
    const operationTimeOut = init.timeout;
    const monitorName = utils.generateRandomString();
    const componentName = utils.generateRandomString();

    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await init.registerEnterpriseUser(user, page);
        await init.logout(page);
        await init.loginUser(user, page);

        done();
    });

    afterAll(async done => {
        // delete monitor
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#components');
        await init.pageClick(page, '#components');
        await page.waitForSelector(`#more-details-${componentName}`);
        await init.pageClick(page, `#more-details-${componentName}`);
        await page.waitForSelector(`#more-details-${monitorName}`);
        await init.pageClick(page, `#more-details-${monitorName}`);
        await page.waitForSelector(`#delete_${monitorName}`);
        await init.pageClick(page, `#delete_${monitorName}`);
        await page.waitForSelector('#deleteMonitor');
        await init.pageClick(page, '#deleteMonitor');
        await page.waitForSelector('#deleteMonitor', { hidden: true });

        // delete component
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#components');
        await init.pageClick(page, '#components');

        await page.waitForSelector(`#more-details-${componentName}`);
        await init.pageClick(page, `#more-details-${componentName}`);
        await page.waitForSelector(`#componentSettings`);
        await init.pageClick(page, `#componentSettings`);
        await page.waitForSelector(`#advanced`);
        await init.pageClick(page, `#advanced`);
        await page.waitForSelector(`#delete-component-${componentName}`);
        await init.pageClick(page, `#delete-component-${componentName}`);
        await page.waitForSelector('#deleteComponent');
        await init.pageClick(page, '#deleteComponent');
        await page.waitForSelector('#deleteComponent', { hidden: true });

        await browser.close();
        done();
    });

    it(
        'Should create new monitor with correct details',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.$eval('#components', el => el.click());

            // Fill and submit New Component form
            await page.waitForSelector('#form-new-component');
            await page.waitForSelector('input[id=name]', { visible: true });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', componentName);
            await init.pageClick(page, 'button[type=submit]');
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.$eval('#components', el => el.click());

            // Navigate to details page of component created in previous test
            await page.waitForSelector(`#more-details-${componentName}`);
            await init.pageClick(page, `#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor', {
                visible: true,
            });

            // Fill and submit New Monitor form
            await init.pageClick(page, 'input[id=name]', { visible: true });
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', monitorName);
            await init.pageClick(page, '[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await init.pageClick(page, '#url');
            await init.pageType(page, '#url', 'https://google.com');
            await init.pageClick(page, 'button[type=submit]');

            let spanElement;
            spanElement = await page.waitForSelector(
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            done();
        },
        operationTimeOut
    );

    it(
        'Should not create new monitor when details are incorrect',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.$eval('#components', el => el.click());

            // Navigate to details page of component created in previous test
            await page.waitForSelector(`#more-details-${componentName}`);
            await init.pageClick(page, `#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor', {
                visible: true,
            });

            // Submit New Monitor form with incorrect details
            await page.waitForSelector('#name');
            await init.pageClick(page, '[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await init.pageType(page, '#url', 'https://google.com');
            await init.pageClick(page, 'button[type=submit]');

            let spanElement;
            spanElement = await page.waitForSelector(
                '#form-new-monitor span#field-error'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('This field cannot be left blank');

            done();
        },
        operationTimeOut
    );
});
