import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName: $TSFixMe: string = utils.generateRandomString();
const containerSecurityName: $TSFixMe: string = utils.generateRandomString();

const dockerRegistryUrl: $TSFixMe = utils.dockerCredential.dockerRegistryUrl;
const dockerUsername: $TSFixMe = utils.dockerCredential.dockerUsername;
const dockerPassword: $TSFixMe = utils.dockerCredential.dockerPassword;
const dockerImagePath: $TSFixMe = utils.dockerCredential.imagePath;
const dockerImageTag: $TSFixMe = utils.dockerCredential.imageTags;

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('OneUptime Page Reload', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

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
        'Should reload the container security page and confirm there are no errors',
        async (done: $TSFixMe) => {
            //const  categoryName: string = 'Random-Category';
            // create a new resource category
            //await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(componentName, page);

            await page.waitForSelector('#security', { visible: true });

            await init.pageClick(page, '#security');

            await init.pageClick(page, '#container');

            await page.waitForSelector('#containerSecurityForm', {
                visible: true,
            });

            await init.pageClick(page, '#addCredentialBtn');
            await page.waitForSelector('#dockerCredentialForm', {
                visible: true,
            });

            await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);

            await init.pageType(page, '#dockerUsername', dockerUsername);

            await init.pageType(page, '#dockerPassword', dockerPassword);

            await init.pageClick(page, '#addCredentialModalBtn');
            await page.waitForSelector('#dockerCredentialForm', {
                hidden: true,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', containerSecurityName);
            // await init.selectDropdownValue(
            //     '#resourceCategory',
            //     categoryName,
            //     page
            // ); // add category
            await init.selectDropdownValue(
                '#dockerCredential',
                dockerUsername,
                page
            );

            await init.pageType(page, '#imagePath', dockerImagePath); // select the created credential

            await init.pageType(page, '#imageTags', dockerImageTag);

            await init.pageClick(page, '#addContainerBtn');

            const containerSecurity: $TSFixMe = await page.waitForSelector(
                `#containerSecurityTitle_${containerSecurityName}`,
                { visible: true }
            );
            expect(containerSecurity).toBeDefined();

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(`#cb${componentName}`, {
                visible: true,
            });
            await page.waitForSelector('#cbContainerSecurity', {
                visible: true,
            });
            await page.waitForSelector(`#cb${containerSecurityName}`, {
                visible: true,
            });

            const spanElement: $TSFixMe = await page.waitForSelector(
                `#containerSecurityTitle_${containerSecurityName}`
            );
            expect(spanElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
