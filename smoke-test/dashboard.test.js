const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

let browser, page;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Monitor API', () => {
    const operationTimeOut = 500000;

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();

    beforeAll(async () => {
        jest.setTimeout(150000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        await init.registerUser(user, page);
        await init.loginUser(user, page);
    });

    afterAll(async () => {
        // delete monitor
        await page.waitForSelector(`#more-details-${monitorName}`);
        await page.click(`#more-details-${monitorName}`);
        await page.waitForSelector(`#delete_${monitorName}`);
        await page.click(`#delete_${monitorName}`);
        await page.waitForSelector('#deleteMonitor');
        await page.click('#deleteMonitor');
        await page.waitFor(2000);

        // delete component
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector(`#delete-component-${componentName}`);
        await page.click(`#delete-component-${componentName}`);
        await page.waitForSelector('#deleteComponent');
        await page.click('#deleteComponent');
        await page.waitFor(2000);

        await browser.close();
    });

    it(
        'Should create new component',
        async () => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL);

            // Fill and submit New Component form
            await page.waitForSelector('#form-new-component');
            await page.click('input[id=name]');
            await page.type('input[id=name]', componentName);
            await page.click('button[type=submit]');
            await page.goto(utils.DASHBOARD_URL);

            let spanElement = await page.waitForSelector(
                `#component-title-${componentName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(componentName);
        },
        operationTimeOut
    );

    it(
        'Should create new monitor with correct details',
        async () => {
            // Navigate to Components page
            await page.waitForSelector('#components');
            await page.click('#components');

            // Navigate to details page of component created in previous test
            await page.waitForSelector(`#more-details-${componentName}`);
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor');

            // Fill and submit New Monitor form
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            await init.selectByText('#type', 'url', page);
            await page.waitForSelector('#url');
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
        },
        operationTimeOut
    );

    it(
        'Should not create new monitor when details that are incorrect',
        async () => {
            // Submit New Monitor form with incorrect details
            await page.waitForSelector('#name');
            await init.selectByText('#type', 'url', page);
            await page.waitForSelector('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

            let spanElement;
            spanElement = await page.waitForSelector(
                '#form-new-monitor span#field-error'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('This field cannot be left blank');
        },
        operationTimeOut
    );
});
