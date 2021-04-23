const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};
describe('Enterprise Monitor API', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user
        await init.registerEnterpriseUser(user, page);
        done();
    });

    afterAll(async done => {
        browser.close();
        done();
    });

    test(
        'Should create new monitor with correct details',
        async done => {
            const componentName = utils.generateRandomString();
            const monitorName = utils.generateRandomString();

            await init.adminLogout(page);
            await init.loginUser(user, page);

            // Create Component first
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            await page.waitForSelector('#form-new-monitor', { visible: true });
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

            let spanElement = await page.waitForSelector(
                `#monitor-title-${monitorName}`,
                { visible: true }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            done();
        },
        operationTimeOut
    );
});
