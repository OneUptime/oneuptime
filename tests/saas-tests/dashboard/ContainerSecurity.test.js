const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const component = 'TestComponent';
const containerSecurityName = 'Test';
const newContainerSecurityName = 'Byter';
let browser, page;
describe('Container Security Page', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(operationTimeOut);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // user
        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should create an application security with a resource category and ensure it redirects to the details page and has category attached',
        async done => {
            const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
            const dockerUsername = utils.dockerCredential.dockerUsername;
            const dockerPassword = utils.dockerCredential.dockerPassword;
            const imagePath = utils.dockerCredential.imagePath;
            const imageTags = utils.dockerCredential.imageTags || '';

            await init.addComponent(component, page);

            const categoryName = 'Random-Category';
            // create a new resource category
            await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(component, page);

            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', {
                visible: true,
            });
            await init.pageClick(page, '#container');

            await page.waitForSelector('#containerSecurityForm', {
                visible: true,
            });
            await init.pageClick(page, '#addCredentialBtn');
            await page.waitForSelector('#dockerCredentialForm', {
                visible: true,
            });
            await init.pageClick(page, '#dockerRegistryUrl');
            await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);
            await init.pageClick(page, '#dockerUsername');
            await init.pageType(page, '#dockerUsername', dockerUsername);
            await init.pageClick(page, '#dockerPassword');
            await init.pageType(page, '#dockerPassword', dockerPassword);
            await init.pageClick(page, '#addCredentialModalBtn');
            await page.waitForSelector('#dockerCredentialForm', {
                hidden: true,
            });

            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', containerSecurityName);
            await init.selectByText('#resourceCategory', categoryName, page); // add category
            await init.pageClick(page, '#dockerCredential');
            await init.pageType(page, '#dockerCredential', dockerUsername);
            await page.keyboard.press('Enter');
            await init.pageClick(page, '#imagePath');
            await init.pageType(page, '#imagePath', imagePath);
            await init.pageClick(page, '#imageTags');
            await init.pageType(page, '#imageTags', imageTags);
            await init.pageClick(page, '#addContainerBtn');

            await page.waitForSelector('.ball-beat', { hidden: true });
            const containerSecurity = await page.waitForSelector(
                `#containerSecurityHeader_${containerSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(containerSecurity).toBeDefined();

            // find the edit button which appears only on the details page
            const editContainerElement = await page.waitForSelector(
                `#edit_${containerSecurityName}`
            );
            expect(editContainerElement).toBeDefined();

            // confirm the category shows in the details page.
            let spanElement = await page.$(`#${containerSecurityName}-badge`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(categoryName.toUpperCase());

            done();
        },
        operationTimeOut
    );

    test(
        'should scan a container security',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#components');

            await page.waitForSelector('#component0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, `#more-details-${component}`);
            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#container');
            await page.waitForSelector('#largeSpinner', { hidden: true });
            await page.waitForSelector(
                `#scanningContainerSecurity_${containerSecurityName}`,
                { hidden: true, timeout: operationTimeOut }
            );
            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );
            const issueCount = await page.waitForSelector('#issueCount', {
                visible: true,
            });
            expect(issueCount).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should view details of the security log',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#components');

            await page.waitForSelector('#component0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, `#more-details-${component}`);
            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#container');
            await page.waitForSelector('#largeSpinner', { hidden: true });
            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );
            const securityLog = await page.waitForSelector('#securityLog', {
                visible: true,
            });

            expect(securityLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should also view details of the security log on clicking the issue count section',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#components');

            await page.waitForSelector('#component0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, `#more-details-${component}`);
            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#container');
            await page.waitForSelector('#largeSpinner', { hidden: true });

            await init.pageClick(page, '#issueCount');
            const securityLog = await page.waitForSelector('#securityLog', {
                visible: true,
            });

            expect(securityLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should display log(s) of a container security scan',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#components');

            await page.waitForSelector('#component0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, `#more-details-${component}`);
            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#container');
            await page.waitForSelector('#largeSpinner', { hidden: true });
            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );

            await page.waitForSelector('#securityLog tbody', {
                visible: true,
            });
            // make sure the added container security
            // have atlest one security vulnerability
            const logs = await page.$$('#securityLog tbody tr');
            expect(logs.length).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );

    test(
        'should edit container security',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#components');

            await page.waitForSelector('#component0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, `#more-details-${component}`);
            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#container');
            await page.waitForSelector('#largeSpinner', { hidden: true });
            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );

            await page.waitForSelector(`#edit_${containerSecurityName}`, {
                visible: true,
            });
            await init.pageClick(page, `#edit_${containerSecurityName}`);
            await page.waitForSelector('#editContainerSecurityForm', {
                visible: true,
            });
            await init.pageClick(page, '#name', { clickCount: 3 });
            await init.pageType(page, '#name', newContainerSecurityName);
            await init.pageClick(page, '#editContainerBtn');
            await page.waitForSelector('#editContainerSecurityForm', {
                hidden: true,
            });

            const textContent = await page.$eval(
                `#containerSecurityTitle_${newContainerSecurityName}`,
                elem => elem.textContent
            );
            expect(textContent).toEqual(newContainerSecurityName);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete container security',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#components');

            await page.waitForSelector('#component0', { visible: true, timeout: init.timeout });
            await init.pageClick(page, `#more-details-${component}`);
            await page.waitForSelector('#security', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#security');
            await page.waitForSelector('#container', { visible: true, timeout: init.timeout });
            await init.pageClick(page, '#container');
            await page.waitForSelector('#largeSpinner', { hidden: true });
            await init.pageClick(
                page,
                `#moreContainerSecurity_${newContainerSecurityName}`
            );
            await page.waitForSelector('#deleteContainerSecurityBtn', {
                visible: true,
            });
            await init.pageClick(page, '#deleteContainerSecurityBtn');
            await page.waitForSelector('#deleteContainerSecurityModalBtn', {
                visible: true,
            });
            await init.pageClick(page, '#deleteContainerSecurityModalBtn');
            await page.waitForNavigation();

            const containerSecurity = await page.waitForSelector(
                `#containerSecurityHeader_${newContainerSecurityName}`,
                { hidden: true }
            );
            expect(containerSecurity).toBeNull();

            done();
        },
        operationTimeOut
    );
});
