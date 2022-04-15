import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const component: string = 'TestComponent';
const applicationSecurityName: string = 'Test';

describe('Application Security Page', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(600000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
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
            const gitUsername: $TSFixMe = utils.gitCredential.gitUsername;
            const gitPassword: $TSFixMe = utils.gitCredential.gitPassword;
            const gitRepositoryUrl: $TSFixMe =
                utils.gitCredential.gitRepositoryUrl;

            await init.addComponent(component, page);

            //const  categoryName: string = 'Random-Category';
            // create a new resource category
            //await init.addResourceCategory(categoryName, page); Resource Category has been removed
            //navigate to component details
            await init.navigateToComponentDetails(component, page);

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
            const applicationSecurity: $TSFixMe =
                await init.pageWaitForSelector(
                    page,
                    `#applicationSecurityHeader_${applicationSecurityName}`,
                    { visible: true, timeout: init.timeout }
                );
            expect(applicationSecurity).toBeDefined();

            // find the edit button which appears only on the details page

            const editApplicationElement: $TSFixMe =
                await init.pageWaitForSelector(
                    page,
                    `#edit_${applicationSecurityName}`
                );
            expect(editApplicationElement).toBeDefined();

            // confirm the category shows in the details page.
            //Resource category has been removed
            // let spanElement: $TSFixMe = await init.page$(
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

    test('should scan an application security', async (done: $TSFixMe) => {
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
        await init.pageWaitForSelector(page, '#application', {
            visible: true,
            timeout: init.timeout,
        });

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

        await init.pageClick(
            page,
            `#moreApplicationSecurity_${applicationSecurityName}`
        );
        const issueCount: $TSFixMe = await init.pageWaitForSelector(
            page,
            '#issueCount',
            {
                visible: true,
                timeout: init.timeout,
            }
        );
        expect(issueCount).toBeDefined();

        done();
    }, 600000);

    test(
        'should view details of security log',
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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );

            await init.pageClick(
                page,
                `#moreApplicationSecurity_${applicationSecurityName}`
            );
            const securityLog: $TSFixMe = await init.pageWaitForSelector(
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

    test(
        'should also view details of a security log, on clicking the issue count section',
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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );

            await init.pageClick(page, '#issueCount');
            const securityLog: $TSFixMe = await init.pageWaitForSelector(
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
        'should display log(s) of an application security scan',
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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );

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

            const logs: $TSFixMe = await init.page$$(
                page,
                '#securityLog tbody tr'
            );
            expect(logs.length).toBeGreaterThanOrEqual(1);

            done();
        },
        operationTimeOut
    );

    test(
        'should edit an application security',
        async (done: $TSFixMe) => {
            const newApplicationName: string = 'AnotherName';

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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${applicationSecurityName}`,
                { visible: true, timeout: init.timeout }
            );

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

            await init.pageType(page, '#name', newApplicationName);

            await init.pageClick(page, '#editApplicationBtn');
            await init.pageWaitForSelector(
                page,
                '#editApplicationSecurityForm',
                {
                    hidden: true,
                }
            );

            const textContent: $TSFixMe = await init.page$Eval(
                page,
                `#applicationSecurityTitle_${newApplicationName}`,
                (elem: $TSFixMe) => {
                    return elem.textContent;
                }
            );
            expect(textContent).toEqual(newApplicationName);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete an application security',
        async (done: $TSFixMe) => {
            const newApplicationName: string = 'AnotherName';

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
            await init.pageWaitForSelector(page, '#application', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#application');
            await init.pageWaitForSelector(
                page,
                `#applicationSecurityHeader_${newApplicationName}`,
                { visible: true, timeout: init.timeout }
            );

            await init.pageClick(
                page,
                `#moreApplicationSecurity_${newApplicationName}`
            );

            await init.pageClick(page, '.advanced-options-tab');
            await init.pageWaitForSelector(
                page,
                '#deleteApplicationSecurityBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, '#deleteApplicationSecurityBtn');
            await init.pageWaitForSelector(
                page,
                '#deleteApplicationSecurityModalBtn',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            await init.pageClick(page, '#deleteApplicationSecurityModalBtn');

            const applicationSecurity: $TSFixMe =
                await init.pageWaitForSelector(
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
