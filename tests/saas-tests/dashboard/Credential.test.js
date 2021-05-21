const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let browser, page;
describe('Credential Page', () => {
    const operationTimeOut = init.timeout;
    const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
    const dockerUsername = utils.dockerCredential.dockerUsername;
    const dockerPassword = utils.dockerCredential.dockerPassword;
    const gitUsername = utils.gitCredential.gitUsername;
    const gitPassword = utils.gitCredential.gitPassword;

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
        'should cancel adding a git credential to a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#gitCredentials');
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            const initialTableRow = await init.page$$(page, 'tbody tr');
            await init.pageWaitForSelector(page, '#addCredentialBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addCredentialBtn');

            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#cancelCredentialModalBtn', e =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                hidden: true,
            });
            const finalTableRow = await init.page$$(page, 'tbody tr');

            expect(initialTableRow.length).toEqual(finalTableRow.length);

            done();
        },
        operationTimeOut
    );

    test(
        'should add a git credential to a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#gitCredentials');
            await init.pageWaitForSelector(page, '#addCredentialBtn', {
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

            const credentialModal = await init.pageWaitForSelector(
                page,
                '#gitCredentialForm',
                { hidden: true }
            );
            expect(credentialModal).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'should update a git credential',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#gitCredentials');

            await init.pageWaitForSelector(page, '#editCredentialBtn_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#editCredentialBtn_0');
            await init.pageWaitForSelector(page, '#gitCredentialForm');
            const gitUsername = 'newusername';
            await init.pageClick(page, '#gitUsername');
            await init.pageType(page, '#gitUsername', gitUsername);
            await init.pageClick(page, '#updateCredentialModalBtn');
            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                hidden: true,
            });
            const updatedCredential = await init.pageWaitForSelector(
                page,
                `#gitUsername_${gitUsername}`,
                { visible: true, timeout: init.timeout }
            );
            expect(updatedCredential).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should cancel deleting a git credential in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#gitCredentials');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            const initialTableRow = await init.page$$(page, 'tbody tr');
            await init.pageClick(page, '#deleteCredentialBtn_0');

            await init.pageWaitForSelector(page, '#cancelCredentialDeleteBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#cancelCredentialDeleteBtn');
            await init.pageWaitForSelector(page, '#deleteCredentialModal', {
                hidden: true,
            });
            const finalTableRow = await init.page$$(page, 'tbody tr');

            expect(initialTableRow.length).toEqual(finalTableRow.length);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete a git credential in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#gitCredentials');

            await init.pageWaitForSelector(page, 'tbody tr', {
                visible: true,
                timeout: init.timeout,
            });
            const initialTableRow = await init.page$$(page, 'tbody tr');
            await init.pageClick(page, '#deleteCredentialBtn_0');

            await init.pageWaitForSelector(page, '#deleteCredentialBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#deleteCredentialBtn');
            await init.pageWaitForSelector(page, '#deleteCredentialModal', {
                hidden: true,
            });
            const finalTableRow = await init.page$$(page, 'tbody tr');

            expect(initialTableRow.length).toBeGreaterThan(
                finalTableRow.length
            );

            done();
        },
        operationTimeOut
    );

    // test(
    //     'should cancel adding docker credential to a project',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);

    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');
    //         await init.pageWaitForSelector(page, '.ball-beat', {
    //             hidden: true,
    //         });
    //         const initialTableRow = await init.page$$(page, 'tbody tr');
    //         await init.pageClick(page, '#addCredentialBtn');

    //         await init.pageWaitForSelector(page, '#dockerCredentialForm', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.page$Eval(page, '#cancelCredentialModalBtn', e =>
    //             e.click()
    //         );
    //         await init.pageWaitForSelector(page, '#dockerCredentialForm', {
    //             hidden: true,
    //         });
    //         const finalTableRow = await init.page$$(page, 'tbody tr');

    //         expect(initialTableRow.length).toEqual(finalTableRow.length);

    //         done();
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should add a docker credential to a project',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);

    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');
    //         await init.pageWaitForSelector(page, '#addCredentialBtn', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#addCredentialBtn');

    //         await init.pageWaitForSelector(page, '#dockerCredentialForm', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerRegistryUrl');
    //         await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);
    //         await init.pageClick(page, '#dockerUsername');
    //         await init.pageType(page, '#dockerUsername', dockerUsername);
    //         await init.pageClick(page, '#dockerPassword');
    //         await init.pageType(page, '#dockerPassword', dockerPassword);
    //         await init.pageClick(page, '#addCredentialModalBtn');

    //         const credentialModalForm = await init.pageWaitForSelector(
    //             page,
    //             '#dockerCredentialForm',
    //             { hidden: true }
    //         );
    //         expect(credentialModalForm).toBeNull();

    //         done();
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should update a docker credential',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);
    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');

    //         await init.pageWaitForSelector(page, '#editCredentialBtn_0');
    //         await init.pageClick(page, '#editCredentialBtn_0');
    //         await init.pageWaitForSelector(page, '#dockerCredentialForm');
    //         const dockerUsername = 'username';
    //         const dockerPassword = 'hello1234567890';
    //         await init.pageClick(page, '#dockerUsername');
    //         await init.pageType(page, '#dockerUsername', dockerUsername);
    //         await init.pageClick(page, '#dockerPassword');
    //         await init.pageType(page, '#dockerPassword', dockerPassword);
    //         await init.pageClick(page, '#updateCredentialModalBtn');
    //         await init.pageWaitForSelector(page, '#dockerCredentialForm', {
    //             hidden: true,
    //         });

    //         const updatedCredential = await init.pageWaitForSelector(
    //             page,
    //             `#dockerUsername_${dockerUsername}`,
    //             { visible: true, timeout: init.timeout }
    //         );
    //         expect(updatedCredential).toBeDefined();

    //         done();
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should not update a docker credential if username or password is invalid',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);
    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');

    //         await init.pageWaitForSelector(page, '#editCredentialBtn_0');
    //         await init.pageClick(page, '#editCredentialBtn_0');
    //         await init.pageWaitForSelector(page, '#dockerCredentialForm');
    //         const dockerUsername = 'invalidusername';
    //         const dockerPassword = 'hello1234567890';
    //         await init.pageClick(page, '#dockerUsername');
    //         await init.pageType(page, '#dockerUsername', dockerUsername);
    //         await init.pageClick(page, '#dockerPassword');
    //         await init.pageType(page, '#dockerPassword', dockerPassword);
    //         await init.pageClick(page, '#updateCredentialModalBtn');

    //         const updateCredentialError = await init.pageWaitForSelector(
    //             page,
    //             '#updateCredentialError',
    //             { visible: true, timeout: operationTimeOut }
    //         );
    //         expect(updateCredentialError).toBeDefined();

    //         done();
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should not add a docker credential to a project if username or password is invalid',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);

    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');
    //         await init.pageWaitForSelector(page, '#addCredentialBtn', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#addCredentialBtn');

    //         await init.pageWaitForSelector(page, '#dockerCredentialForm', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerRegistryUrl');
    //         await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);
    //         await init.pageClick(page, '#dockerUsername');
    //         await init.pageType(page, '#dockerUsername', 'randomusername');
    //         await init.pageClick(page, '#dockerPassword');
    //         await init.pageType(page, '#dockerPassword', 'invalidpassword');
    //         await init.pageClick(page, '#addCredentialModalBtn');

    //         const addCredentialError = await init.pageWaitForSelector(
    //             page,
    //             '#addCredentialError',
    //             { visible: true, timeout: operationTimeOut }
    //         );
    //         expect(addCredentialError).toBeDefined();

    //         done();
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should cancel deleting a docker credential in a project',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);

    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');

    //         await init.pageWaitForSelector(page, '.ball-beat', {
    //             hidden: true,
    //         });
    //         const initialTableRow = await init.page$$(page, 'tbody tr');
    //         await init.pageClick(page, '#deleteCredentialBtn_0');

    //         await init.pageWaitForSelector(page, '#cancelCredentialDeleteBtn', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#cancelCredentialDeleteBtn');
    //         await init.pageWaitForSelector(page, '#deleteCredentialModal', {
    //             hidden: true,
    //         });
    //         const finalTableRow = await init.page$$(page, 'tbody tr');

    //         expect(initialTableRow.length).toEqual(finalTableRow.length);

    //         done();
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should delete a docker credential in a project',
    //     async done => {
    //         await page.goto(utils.DASHBOARD_URL);

    //         await init.pageWaitForSelector(page, '#projectSettings', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#projectSettings');
    //         await init.pageWaitForSelector(page, '#more');
    //         await init.pageClick(page, '#more');
    //         await init.pageWaitForSelector(page, '#dockerCredentials', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#dockerCredentials');

    //         await init.pageWaitForSelector(page, 'tbody tr', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         const initialTableRow = await init.page$$(page, 'tbody tr');
    //         await init.pageClick(page, '#deleteCredentialBtn_0');

    //         await init.pageWaitForSelector(page, '#deleteCredentialBtn', {
    //             visible: true,
    //             timeout: init.timeout,
    //         });
    //         await init.pageClick(page, '#deleteCredentialBtn');
    //         await init.pageWaitForSelector(page, '#deleteCredentialModal', {
    //             hidden: true,
    //         });
    //         const finalTableRow = await init.page$$(page, 'tbody tr');

    //         expect(initialTableRow.length).toBeGreaterThan(
    //             finalTableRow.length
    //         );

    //         done();
    //     },
    //     operationTimeOut
    // );
});
