import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

describe('Project API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should create new project from dropdown after login',
        async (done: $TSFixMe) => {
            const projectName = utils.generateRandomString();
            //Login is no longer required as Dashboard page is loaded automatically.
            await init.pageWaitForSelector(page, '#selector', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#create-project', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#name', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', projectName);

            await init.pageClick(page, 'label[for=Startup_month]');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, `#cb${projectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            const localStorageData = await page.evaluate(() => {
                const json: $TSFixMe = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);

                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('project');

            done();
        },
        operationTimeOut
    );
});
