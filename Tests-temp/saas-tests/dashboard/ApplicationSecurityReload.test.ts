import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
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

describe('OneUptime Page Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.addComponent(componentName, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should reload the application security page and confirm there are no errors',
        async (done: $TSFixMe) => {
            //const categoryName = 'Random-Category';
            // create a new resource category
            // await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(componentName, page);

            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');

            await init.pageWaitForSelector(page, '#applicationSecurityForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addCredentialBtn');
            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#gitUsername');

            await init.pageType(page, '#gitUsername', gitUsername);

            await init.pageClick(page, '#gitPassword');

            await init.pageType(page, '#gitPassword', gitPassword);

            await init.pageClick(page, '#addCredentialModalBtn');
            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                hidden: true,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', applicationSecurityName);
            // await init.selectDropdownValue(
            //     '#resourceCategory',
            //     categoryName,
            //     page
            // ); // add category

            await init.pageClick(page, '#gitRepositoryUrl');

            await init.pageType(page, '#gitRepositoryUrl', gitRepositoryUrl);

            await init.pageClick(page, '#gitCredential');

            await init.pageType(page, '#gitCredential', gitUsername); // select the created credential
            await page.keyboard.press('Enter'); // Enter Key

            await init.pageClick(page, '#addApplicationBtn');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            const applicationSecurity = await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(applicationSecurity).toBeDefined();

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, `#cb${componentName}`, {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#cbApplicationSecurity', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(
                page,
                `#cb${applicationSecurityName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            const spanElement = await init.pageWaitForSelector(
                page,
                `#applicationSecurityTitle_${applicationSecurityName}`
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
