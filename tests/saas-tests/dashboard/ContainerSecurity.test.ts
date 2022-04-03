import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const component = 'TestComponent';
const containerSecurityName = 'Test';
const newContainerSecurityName = 'Byter';
let browser: $TSFixMe, page: $TSFixMe;

describe('Container Security Page', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
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

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should create an application security with a resource category and ensure it redirects to the details page and has category attached',
        async (done: $TSFixMe) => {
            const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
            const dockerUsername = utils.dockerCredential.dockerUsername;
            const dockerPassword = utils.dockerCredential.dockerPassword;
            const imagePath = utils.dockerCredential.imagePath;
            const imageTags = utils.dockerCredential.imageTags || '';

            await init.addComponent(component, page);

            //const categoryName = 'Random-Category';
            // create a new resource category
            // await init.addResourceCategory(categoryName, page);
            //navigate to component details
            await init.navigateToComponentDetails(component, page);

            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#container');

            await init.pageWaitForSelector(page, '#containerSecurityForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addCredentialBtn');
            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerRegistryUrl');

            await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);

            await init.pageClick(page, '#dockerUsername');

            await init.pageType(page, '#dockerUsername', dockerUsername);

            await init.pageClick(page, '#dockerPassword');

            await init.pageType(page, '#dockerPassword', dockerPassword);

            await init.pageClick(page, '#addCredentialModalBtn');
            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                hidden: true,
            });

            await init.pageClick(page, '#name');

            await init.pageType(page, '#name', containerSecurityName);
            // await init.selectDropdownValue(
            //     '#resourceCategory',
            //     categoryName,
            //     page
            // ); // add category

            await init.pageClick(page, '#dockerCredential');

            await init.pageType(page, '#dockerCredential', dockerUsername);
            await page.keyboard.press('Enter');

            await init.pageClick(page, '#imagePath');

            await init.pageType(page, '#imagePath', imagePath);

            await init.pageClick(page, '#imageTags');

            await init.pageType(page, '#imageTags', imageTags);

            await init.pageClick(page, '#addContainerBtn');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            const containerSecurity = await init.pageWaitForSelector(
                page,
                `#containerSecurityHeader_${containerSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(containerSecurity).toBeDefined();

            // find the edit button which appears only on the details page

            const editContainerElement = await init.pageWaitForSelector(
                page,
                `#edit_${containerSecurityName}`
            );
            expect(editContainerElement).toBeDefined();

            // confirm the category shows in the details page.
            // let spanElement = await init.page$(
            //     page,
            //     `#${containerSecurityName}-badge`
            // );
            // spanElement = await spanElement.getProperty('innerText');
            // spanElement = await spanElement.jsonValue();
            // spanElement.should.be.exactly(categoryName.toUpperCase());

            done();
        },
        operationTimeOut
    );

    test('should scan a container security', async (done: $TSFixMe) => {
        await page.goto(utils.DASHBOARD_URL);
        await init.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: init.timeout,
        });

        await init.pageClick(page, '#components');

        await init.pageWaitForSelector(page, '#component0', {
            visible: true,
            timeout: init.timeout,
        });

        await init.pageClick(page, `#more-details-${component}`);
        await init.pageWaitForSelector(page, '#security', {
            visible: true,
            timeout: init.timeout,
        });

        await init.pageClick(page, '#security');
        await init.pageWaitForSelector(page, '#container', {
            visible: true,
            timeout: init.timeout,
        });

        await init.pageClick(page, '#container');
        await init.pageWaitForSelector(page, '#largeSpinner', {
            hidden: true,
        });
        await init.pageWaitForSelector(
            page,
            `#scanningContainerSecurity_${containerSecurityName}`,
            { hidden: true, timeout: 600000 } //Pinging takes 5 minutes and scanning takes some more time
        );

        await init.pageClick(
            page,
            `#moreContainerSecurity_${containerSecurityName}`
        );
        const issueCount = await init.pageWaitForSelector(
            page,
            '#vulnerabilities',
            {
                visible: true,
                timeout: init.timeout,
            }
        );
        expect(issueCount).toBeDefined();

        done();
    }, 600000);

    test(
        'should view details of the security log',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });

            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );
            const securityLog = await init.pageWaitForSelector(
                page,
                '#securityLog',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            expect(securityLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should also view details of the security log on clicking the issue count section',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });

            await init.pageClick(page, '#issueCount');
            const securityLog = await init.pageWaitForSelector(
                page,
                '#securityLog',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            expect(securityLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should display log(s) of a container security scan',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });

            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );

            await init.pageWaitForSelector(page, '#securityLog tbody', {
                visible: true,
                timeout: init.timeout,
            });
            // make sure the added container security
            // have atlest one security vulnerability

            const logs = await init.page$$(page, '#securityLog tbody tr');
            expect(logs.length).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );

    test(
        'should edit container security',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });

            await init.pageClick(
                page,
                `#moreContainerSecurity_${containerSecurityName}`
            );

            await init.pageWaitForSelector(
                page,
                `#edit_${containerSecurityName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, `#edit_${containerSecurityName}`);
            await init.pageWaitForSelector(page, '#editContainerSecurityForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name', { clickCount: 3 });

            await init.pageType(page, '#name', newContainerSecurityName);

            await init.pageClick(page, '#editContainerBtn');
            await init.pageWaitForSelector(page, '#editContainerSecurityForm', {
                hidden: true,
            });

            const textContent = await init.page$Eval(
                page,
                `#containerSecurityTitle_${newContainerSecurityName}`,
                (elem: $TSFixMe) => elem.textContent
            );
            expect(textContent).toEqual(newContainerSecurityName);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete container security',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });

            await init.pageClick(
                page,
                `#moreContainerSecurity_${newContainerSecurityName}`
            );

            await init.pageClick(page, '.advanced-options-tab');
            await init.pageWaitForSelector(
                page,
                '#deleteContainerSecurityBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, '#deleteContainerSecurityBtn');
            await init.pageWaitForSelector(
                page,
                '#deleteContainerSecurityModalBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, '#deleteContainerSecurityModalBtn');

            const containerSecurity = await init.pageWaitForSelector(
                page,
                `#containerSecurityHeader_${newContainerSecurityName}`,
                { hidden: true }
            );
            expect(containerSecurity).toBeNull();

            done();
        },
        operationTimeOut
    );
});
