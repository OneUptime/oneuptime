const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Enterprise Dashboard API', () => {
    const operationTimeOut = 100000;
    const monitorName = utils.generateRandomString();
    const componentName = utils.generateRandomString();

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
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
        await page.click('#components');
        await page.waitForSelector(`#more-details-${componentName}`);
        await page.click(`#more-details-${componentName}`);
        await page.waitForSelector(`#more-details-${monitorName}`);
        await page.click(`#more-details-${monitorName}`);
        await page.waitForSelector(`#delete_${monitorName}`);
        await page.click(`#delete_${monitorName}`);
        await page.waitForSelector('#deleteMonitor');
        await page.click('#deleteMonitor');
        await page.waitForSelector('#deleteMonitor', { hidden: true });

        // delete component
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#components');
        await page.click('#components');

        await page.waitForSelector(`#more-details-${componentName}`);
        await page.click(`#more-details-${componentName}`);
        await page.waitForSelector(`#componentSettings`);
        await page.click(`#componentSettings`);
        await page.waitForSelector(`#advanced`);
        await page.click(`#advanced`);
        await page.waitForSelector(`#delete-component-${componentName}`);
        await page.click(`#delete-component-${componentName}`);
        await page.waitForSelector('#deleteComponent');
        await page.click('#deleteComponent');
        await page.waitForSelector('#deleteComponent', { hidden: true });

        await browser.close();
        done();
    });

    it(
        'Should create new monitor with correct details',
        async done => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await page.$eval('#components', el => el.click());

            // Fill and submit New Component form
            await page.waitForSelector('#form-new-component');
            await page.click('input[id=name]');
            await page.type('input[id=name]', componentName);
            await page.click('button[type=submit]');
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.$eval('#components', el => el.click());

            // Navigate to details page of component created in previous test
            await page.waitForSelector(`#more-details-${componentName}`);
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor', {
                visible: true,
            });

            // Fill and submit New Monitor form
            await page.click('input[id=name]', { visible: true });
            await page.type('input[id=name]', monitorName);
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', {visible: true});
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

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
                waitUntil: 'networkidle0',
            });

            await page.$eval('#components', el => el.click());

            // Navigate to details page of component created in previous test
            await page.waitForSelector(`#more-details-${componentName}`);
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor', {
                visible: true,
            });

            // Submit New Monitor form with incorrect details
            await page.waitForSelector('#name');
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', {visible: true});
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

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
