// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const component = 'TestComponent';
const containerSecurityName = 'Test';
const newContainerSecurityName = 'Byter';
let browser: $TSFixMe, page: $TSFixMe;
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Container Security Page', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#container');

            await init.pageWaitForSelector(page, '#containerSecurityForm', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCredentialBtn');
            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#dockerRegistryUrl');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#dockerUsername');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#dockerUsername', dockerUsername);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#dockerPassword');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#dockerPassword', dockerPassword);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCredentialModalBtn');
            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', containerSecurityName);
            // await init.selectDropdownValue(
            //     '#resourceCategory',
            //     categoryName,
            //     page
            // ); // add category
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#dockerCredential');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#dockerCredential', dockerUsername);
            await page.keyboard.press('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#imagePath');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#imagePath', imagePath);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#imageTags');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#imageTags', imageTags);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should scan a container security', async (done: $TSFixMe) => {
        await page.goto(utils.DASHBOARD_URL);
        await init.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#components');

        await init.pageWaitForSelector(page, '#component0', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, `#more-details-${component}`);
        await init.pageWaitForSelector(page, '#security', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#security');
        await init.pageWaitForSelector(page, '#container', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#container');
        await init.pageWaitForSelector(page, '#largeSpinner', {
            hidden: true,
        });
        await init.pageWaitForSelector(
            page,
            `#scanningContainerSecurity_${containerSecurityName}`,
            { hidden: true, timeout: 600000 } //Pinging takes 5 minutes and scanning takes some more time
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should view details of the security log',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should also view details of the security log on clicking the issue count section',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should display log(s) of a container security scan',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const logs = await init.page$$(page, '#securityLog tbody tr');
            expect(logs.length).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should edit container security',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#edit_${containerSecurityName}`);
            await init.pageWaitForSelector(page, '#editContainerSecurityForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#name', { clickCount: 3 });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', newContainerSecurityName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete container security',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#more-details-${component}`);
            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#container', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#container');
            await init.pageWaitForSelector(page, '#largeSpinner', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#moreContainerSecurity_${newContainerSecurityName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.advanced-options-tab');
            await init.pageWaitForSelector(
                page,
                '#deleteContainerSecurityBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteContainerSecurityBtn');
            await init.pageWaitForSelector(
                page,
                '#deleteContainerSecurityModalBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
