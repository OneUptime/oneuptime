import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const user = {
    email,
    password,
};

describe('Enterprise Monitor API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        await init.registerEnterpriseUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        browser.close();
        done();
    });

    test(
        'Should create new monitor with correct details',
        async (done: $TSFixMe) => {
            const componentName = utils.generateRandomString();
            const monitorName = utils.generateRandomString();

            await init.adminLogout(page);
            await init.loginUser(user, page);

            // Create Component first
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            await init.pageWaitForSelector(page, '#form-new-monitor', {
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

            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#url');

            await init.pageType(page, '#url', 'https://google.com');

            await init.pageClick(page, 'button[type=submit]');

            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`,
                { visible: true, timeout: init.timeout }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            done();
        },
        operationTimeOut
    );
});
