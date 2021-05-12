const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const containerSecurityName = utils.generateRandomString();

const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
const dockerUsername = utils.dockerCredential.dockerUsername;
const dockerPassword = utils.dockerCredential.dockerPassword;
const imagePath = utils.dockerCredential.imagePath;
const imageTags = utils.dockerCredential.imageTags || '';

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
            await page.waitForSelector('#container', {
                visible: true,
            });
            await page.click('#container');

            await page.waitForSelector('#containerSecurityForm', {
                visible: true,
            });
            await page.click('#addCredentialBtn');
            await page.waitForSelector('#dockerCredentialForm', {
                visible: true,
            });
            await page.click('#dockerRegistryUrl');
            await page.type('#dockerRegistryUrl', dockerRegistryUrl);
            await page.click('#dockerUsername');
            await page.type('#dockerUsername', dockerUsername);
            await page.click('#dockerPassword');
            await page.type('#dockerPassword', dockerPassword);
            await page.click('#addCredentialModalBtn');
            await page.waitForSelector('#dockerCredentialForm', {
                hidden: true,
            });

            await page.click('#name');
            await page.type('#name', containerSecurityName);
            await init.selectByText(
                '#resourceCategory',
                categoryName,
                page
            ); // add category
            await page.click('#dockerCredential');
            await page.type('#dockerCredential', dockerUsername);
            await page.keyboard.press('Enter');
            await page.click('#imagePath');
            await page.type('#imagePath', imagePath);
            await page.click('#imageTags');
            await page.type('#imageTags', imageTags);
            await page.click('#addContainerBtn');

            const containerSecurity = await page.waitForSelector(
                `#containerSecurityHeader_${containerSecurityName}`,
                { visible: true }
            );
            expect(containerSecurity).toBeDefined();

            done();
        },
        operationTimeOut
    );

});
