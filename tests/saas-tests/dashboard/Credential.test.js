import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let browser, page;
describe('Credential Page', () => {
    const operationTimeOut = init.timeout;
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
            // When no git credential is added, no 'tr'.
            let noGitCredential = await init.pageWaitForSelector(
                page,
                '#noGitCredential'
            );
            noGitCredential = await noGitCredential.getProperty('innerText');
            noGitCredential = await noGitCredential.jsonValue();
            noGitCredential.should.be.exactly(
                'There are no git credentials for this project'
            );

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

            let noGitCredential2 = await init.pageWaitForSelector(
                page,
                '#noGitCredential'
            );
            noGitCredential2 = await noGitCredential2.getProperty('innerText');
            noGitCredential2 = await noGitCredential2.jsonValue();
            noGitCredential2.should.be.exactly(
                'There are no git credentials for this project'
            );

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
            await init.pageClick(page, '#gitUsername', { clickCount: 3 });
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
            let noGitCredential3 = await init.pageWaitForSelector(
                page,
                '#noGitCredential'
            );
            noGitCredential3 = await noGitCredential3.getProperty('innerText');
            noGitCredential3 = await noGitCredential3.jsonValue();
            noGitCredential3.should.be.exactly(
                'There are no git credentials for this project'
            );

            done();
        },
        operationTimeOut
    );

    /**Test Split */
});
