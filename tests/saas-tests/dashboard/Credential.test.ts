// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let browser: $TSFixMe, page: $TSFixMe;
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Credential Page', () => {
    const operationTimeOut = init.timeout;
    const gitUsername = utils.gitCredential.gitUsername;
    const gitPassword = utils.gitCredential.gitPassword;

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
        'should cancel adding a git credential to a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitCredentials');
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            // When no git credential is added, no 'tr'.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCredentialBtn');

            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(
                page,
                '#cancelCredentialModalBtn',
                (e: $TSFixMe) => e.click()
            );

            await init.pageWaitForSelector(page, '#gitCredentialForm', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should add a git credential to a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitCredentials');
            await init.pageWaitForSelector(page, '#addCredentialBtn', {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should update a git credential',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitCredentials');

            await init.pageWaitForSelector(page, '#editCredentialBtn_0', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#editCredentialBtn_0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#gitCredentialForm');
            const gitUsername = 'newusername';
            await init.pageClick(page, '#gitUsername', { clickCount: 3 });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#gitUsername', gitUsername);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should cancel deleting a git credential in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitCredentials');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const initialTableRow = await init.page$$(page, 'tbody tr');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCredentialBtn_0');

            await init.pageWaitForSelector(page, '#cancelCredentialDeleteBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#cancelCredentialDeleteBtn');
            await init.pageWaitForSelector(page, '#deleteCredentialModal', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const finalTableRow = await init.page$$(page, 'tbody tr');

            expect(initialTableRow.length).toEqual(finalTableRow.length);

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete a git credential in a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#gitCredentials', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#gitCredentials');

            await init.pageWaitForSelector(page, 'tbody tr', {
                visible: true,
                timeout: init.timeout,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCredentialBtn_0');

            await init.pageWaitForSelector(page, '#deleteCredentialBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCredentialBtn');
            await init.pageWaitForSelector(page, '#deleteCredentialModal', {
                hidden: true,
            });
            // When no git credential is added, no 'tr'.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
