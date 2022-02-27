// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const component = 'TestComponent';
const applicationSecurityName = 'Test';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Application Security Page', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(600000);

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
            const gitUsername = utils.gitCredential.gitUsername;
            const gitPassword = utils.gitCredential.gitPassword;
            const gitRepositoryUrl = utils.gitCredential.gitRepositoryUrl;

            await init.addComponent(component, page);

            //const categoryName = 'Random-Category';
            // create a new resource category
            //await init.addResourceCategory(categoryName, page); Resource Category has been removed
            //navigate to component details
            await init.navigateToComponentDetails(component, page);

            await init.pageWaitForSelector(page, '#security', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#security');
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#application');

            await init.pageWaitForSelector(page, '#applicationSecurityForm', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCredentialBtn');
            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitUsername');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#gitUsername', gitUsername);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitPassword');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#gitPassword', gitPassword);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCredentialModalBtn');
            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', applicationSecurityName);
            // await init.selectDropdownValue(
            //     '#resourceCategory',
            //     categoryName,
            //     page
            // ); // add category
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitRepositoryUrl');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#gitRepositoryUrl', gitRepositoryUrl);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitCredential');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#gitCredential', gitUsername); // select the created credential
            await page.keyboard.press('Enter'); // Enter Key
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

            // find the edit button which appears only on the details page
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const editApplicationElement = await init.pageWaitForSelector(
                page,
                `#edit_${applicationSecurityName}`
            );
            expect(editApplicationElement).toBeDefined();

            // confirm the category shows in the details page.
            //Resource category has been removed
            // let spanElement = await init.page$(
            //     page,
            //     `#${applicationSecurityName}-badge`
            // );
            // spanElement = await spanElement.getProperty('innerText');
            // spanElement = await spanElement.jsonValue();
            // spanElement.should.be.exactly(categoryName.toUpperCase());

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should scan an application security', async (done: $TSFixMe) => {
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
        await init.pageWaitForSelector(page, '#application', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#application');
        await init.pageWaitForSelector(
            page,
            `#applicationSecurityHeader_${applicationSecurityName}`,
            { visible: true, timeout: 600000 }
        );

        await init.pageWaitForSelector(
            page,
            `#scanningApplicationSecurity_${applicationSecurityName}`,
            { hidden: true, timeout: 600000 }
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(
            page,
            `#moreApplicationSecurity_${applicationSecurityName}`
        );
        const issueCount = await init.pageWaitForSelector(page, '#issueCount', {
            visible: true,
            timeout: init.timeout,
        });
        expect(issueCount).toBeDefined();

        done();
    }, 600000);

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should view details of security log',
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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#moreApplicationSecurity_${applicationSecurityName}`
            );
            const securityLog = await init.pageWaitForSelector(
                page,
                '#securityLog',
                {
                    visible: true,
                    timeout: 600000, //Pinging takes 5 minutes and scanning takes some more time
                }
            );

            expect(securityLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should also view details of a security log, on clicking the issue count section',
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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
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
        'should display log(s) of an application security scan',
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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#moreApplicationSecurity_${applicationSecurityName}`
            );

            await init.pageWaitForSelector(page, '#securityLog tbody', {
                visible: true,
                timeout: init.timeout,
            });
            // make sure the added application security
            // has atleast one security vulnerability
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const logs = await init.page$$(page, '#securityLog tbody tr');
            expect(logs.length).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should edit an application security',
        async (done: $TSFixMe) => {
            const newApplicationName = 'AnotherName';

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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#moreApplicationSecurity_${applicationSecurityName}`
            );

            await init.pageWaitForSelector(
                page,
                `#edit_${applicationSecurityName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#edit_${applicationSecurityName}`);
            await init.pageWaitForSelector(
                page,
                '#editApplicationSecurityForm',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.pageClick(page, '#name', { clickCount: 3 });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#name', newApplicationName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#editApplicationBtn');
            await init.pageWaitForSelector(
                page,
                '#editApplicationSecurityForm',
                {
                    hidden: true,
                }
            );

            const textContent = await init.page$Eval(
                page,
                `#applicationSecurityTitle_${newApplicationName}`,
                (elem: $TSFixMe) => elem.textContent
            );
            expect(textContent).toEqual(newApplicationName);

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete an application security',
        async (done: $TSFixMe) => {
            const newApplicationName = 'AnotherName';

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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${newApplicationName}`,
                { visible: true, timeout: init.timeout }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `#moreApplicationSecurity_${newApplicationName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.advanced-options-tab');
            await init.pageWaitForSelector(
                page,
                '#deleteApplicationSecurityBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteApplicationSecurityBtn');
            await init.pageWaitForSelector(
                page,
                '#deleteApplicationSecurityModalBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteApplicationSecurityModalBtn');

            const applicationSecurity = await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${newApplicationName}`,
                { hidden: true }
            );
            expect(applicationSecurity).toBeNull();

            done();
        },
        operationTimeOut
    );
});
