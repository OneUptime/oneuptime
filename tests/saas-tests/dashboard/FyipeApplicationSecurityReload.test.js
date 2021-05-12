const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const applicationSecurityName = utils.generateRandomString();

const gitUsername = utils.gitCredential.gitUsername;
const gitPassword = utils.gitCredential.gitPassword;
const gitRepositoryUrl = utils.gitCredential.gitRepositoryUrl;

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Page Reload', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(100000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.addComponent(componentName, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the incidents page and confirm there are no errors',
        async done => {
            const categoryName = 'Random-Category';
            // create a new resource category
            await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(componentName, page);

            await page.waitForSelector('#security', { visible: true });
            await page.click('#security');
            await page.waitForSelector('#application', { visible: true });
            await page.click('#application');

            await page.waitForSelector('#applicationSecurityForm', {
                visible: true,
            });
            await page.click('#addCredentialBtn');
            await page.waitForSelector('#gitCredentialForm', {
                visible: true,
            });
            await page.click('#gitUsername');
            await init.pageType(page, '#gitUsername', gitUsername);
            await page.click('#gitPassword');
            await init.pageType(page, '#gitPassword', gitPassword);
            await page.click('#addCredentialModalBtn');
            await page.waitForSelector('#gitCredentialForm', {
                hidden: true,
            });

            await page.click('#name');
            await init.pageType(page, '#name', applicationSecurityName);
            await init.selectByText('#resourceCategory', categoryName, page); // add category
            await page.click('#gitRepositoryUrl');
            await init.pageType(page, '#gitRepositoryUrl', gitRepositoryUrl);
            await page.click('#gitCredential');
            await init.pageType(page, '#gitCredential', gitUsername); // select the created credential
            await page.keyboard.press('Enter'); // Enter Key
            await page.click('#addApplicationBtn');

            await page.waitForSelector('.ball-beat', { hidden: true });
            const applicationSecurity = await page.waitForSelector(
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true }
            );
            expect(applicationSecurity).toBeDefined();

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
            });
            await page.waitForSelector('#cbApplicationSecurity', {
                visible: true,
            });
            await page.waitForSelector(`#cb${applicationSecurityName}`, {
                visible: true,
            });

            const spanElement = await page.waitForSelector(
                `#applicationSecurityTitle_${applicationSecurityName}`
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
