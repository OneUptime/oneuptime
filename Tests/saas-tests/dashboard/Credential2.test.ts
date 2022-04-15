import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
let browser: $TSFixMe, page: $TSFixMe;

describe('Credential Page', () => {
    const operationTimeOut: $TSFixMe = init.timeout;
    const dockerRegistryUrl: $TSFixMe =
        utils.dockerCredential.dockerRegistryUrl;
    const dockerUsername: $TSFixMe = utils.dockerCredential.dockerUsername;
    const dockerPassword: $TSFixMe = utils.dockerCredential.dockerPassword;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(operationTimeOut);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };
        // User
        await init.registerUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should cancel adding docker credential to a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            // When no git credential is added, no 'tr'.

            let noGitCredential: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#noDockerCredential'
            );
            noGitCredential = await noGitCredential.getProperty('innerText');
            noGitCredential = await noGitCredential.jsonValue();
            noGitCredential.should.be.exactly(
                'There are no docker credentials for this project'
            );

            await init.pageClick(page, '#addCredentialBtn');

            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(
                page,
                '#cancelCredentialModalBtn',
                (e: $TSFixMe) => {
                    return e.click();
                }
            );
            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                hidden: true,
            });

            let noGitCredential2: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#noDockerCredential'
            );
            noGitCredential2 = await noGitCredential2.getProperty('innerText');
            noGitCredential2 = await noGitCredential2.jsonValue();
            noGitCredential2.should.be.exactly(
                'There are no docker credentials for this project'
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should add a docker credential to a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');
            await init.pageWaitForSelector(page, '#addCredentialBtn', {
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

            const credentialModalForm: $TSFixMe =
                await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                    hidden: true,
                });
            expect(credentialModalForm).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'should update a docker credential',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');

            await init.pageWaitForSelector(page, '#editCredentialBtn_0');

            await init.pageClick(page, '#editCredentialBtn_0');

            await init.pageWaitForSelector(page, '#dockerCredentialForm');
            const dockerUsername: string = 'username';
            const dockerPassword: string = 'hello1234567890';
            await init.pageClick(page, '#dockerUsername', { clickCount: 3 });

            await init.pageType(page, '#dockerUsername', dockerUsername);
            await init.pageClick(page, '#dockerPassword', { clickCount: 3 });

            await init.pageType(page, '#dockerPassword', dockerPassword);

            await init.pageClick(page, '#updateCredentialModalBtn');
            await init.pageWaitForSelector(page, '#dockerCredentialForm', {
                hidden: true,
            });

            const updatedCredential: $TSFixMe = await init.pageWaitForSelector(
                page,
                `#dockerUsername_${dockerUsername}`,
                { visible: true, timeout: init.timeout }
            );
            expect(updatedCredential).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not update a docker credential if username or password is invalid',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');

            await init.pageWaitForSelector(page, '#editCredentialBtn_0');

            await init.pageClick(page, '#editCredentialBtn_0');

            await init.pageWaitForSelector(page, '#dockerCredentialForm');
            const dockerUsername: string = 'invalidusername';
            const dockerPassword: string = 'hello1234567890';

            await init.pageClick(page, '#dockerUsername');

            await init.pageType(page, '#dockerUsername', dockerUsername);

            await init.pageClick(page, '#dockerPassword');

            await init.pageType(page, '#dockerPassword', dockerPassword);

            await init.pageClick(page, '#updateCredentialModalBtn');

            const updateCredentialError: $TSFixMe =
                await init.pageWaitForSelector(page, '#updateCredentialError', {
                    visible: true,
                    timeout: operationTimeOut,
                });
            expect(updateCredentialError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should not add a docker credential to a project if username or password is invalid',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');
            await init.pageWaitForSelector(page, '#addCredentialBtn', {
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

            await init.pageType(page, '#dockerUsername', 'randomusername');

            await init.pageClick(page, '#dockerPassword');

            await init.pageType(page, '#dockerPassword', 'invalidpassword');

            await init.pageClick(page, '#addCredentialModalBtn');

            const addCredentialError: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#addCredentialError',
                { visible: true, timeout: operationTimeOut }
            );
            expect(addCredentialError).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should cancel deleting a docker credential in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            const initialTableRow: $TSFixMe = await init.page$$(
                page,
                'tbody tr'
            );

            await init.pageClick(page, '#deleteCredentialBtn_0');

            await init.pageWaitForSelector(page, '#cancelCredentialDeleteBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#cancelCredentialDeleteBtn');
            await init.pageWaitForSelector(page, '#deleteCredentialModal', {
                hidden: true,
            });

            const finalTableRow: $TSFixMe = await init.page$$(page, 'tbody tr');

            expect(initialTableRow.length).toEqual(finalTableRow.length);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete a docker credential in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#dockerCredentials', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#dockerCredentials');

            await init.pageWaitForSelector(page, 'tbody tr', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteCredentialBtn_0');

            await init.pageWaitForSelector(page, '#deleteCredentialBtn', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#deleteCredentialBtn');
            await init.pageWaitForSelector(page, '#deleteCredentialModal', {
                hidden: true,
            });
            // When no git credential is added, no 'tr'.

            let noGitCredential3: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#noDockerCredential'
            );
            noGitCredential3 = await noGitCredential3.getProperty('innerText');
            noGitCredential3 = await noGitCredential3.jsonValue();
            noGitCredential3.should.be.exactly(
                'There are no docker credentials for this project'
            );

            done();
        },
        operationTimeOut
    );
});
