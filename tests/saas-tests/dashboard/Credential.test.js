const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');


require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Credential Page', () => {
    const operationTimeOut = init.timeout;
    const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
    const dockerUsername = utils.dockerCredential.dockerUsername;
    const dockerPassword = utils.dockerCredential.dockerPassword;
    const gitUsername = utils.gitCredential.gitUsername;
    const gitPassword = utils.gitCredential.gitPassword;

    
    beforeAll(async done => {
        jest.setTimeout(operationTimeOut);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: operationTimeOut,
        });

        cluster.on('error', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerUser(user, page);
            done();
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should cancel adding a git credential to a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#gitCredentials');
                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#addCredentialBtn');

                await page.waitForSelector('#gitCredentialForm', {
                    visible: true,
                });
                await page.$eval('#cancelCredentialModalBtn', e => e.click());

                await page.waitForSelector('#gitCredentialForm', {
                    hidden: true,
                });
                const finalTableRow = await page.$$('tbody tr');

                expect(initialTableRow.length).toEqual(finalTableRow.length);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should add a git credential to a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#gitCredentials');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#addCredentialBtn');

                await page.waitForSelector('#gitCredentialForm', {
                    visible: true,
                });
                await init.pageClick(page, '#gitUsername');
                await init.pageType(page, '#gitUsername', gitUsername);
                await init.pageClick(page, '#gitPassword');
                await init.pageType(page, '#gitPassword', gitPassword);
                await init.pageClick(page, '#addCredentialModalBtn');

                const credentialModal = await page.waitForSelector(
                    '#gitCredentialForm',
                    { hidden: true }
                );
                expect(credentialModal).toBeNull();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should update a git credential',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#gitCredentials');

                await page.waitForSelector('#editCredentialBtn_0', {
                    visible: true,
                });
                await init.pageClick(page, '#editCredentialBtn_0');
                await page.waitForSelector('#gitCredentialForm');
                const gitUsername = 'newusername';
                await init.pageClick(page, '#gitUsername', { clickCount: 3 });
                await init.pageType(page, '#gitUsername', gitUsername);
                await init.pageClick(page, '#updateCredentialModalBtn');
                await page.waitForSelector('#gitCredentialForm', {
                    hidden: true,
                });
                const updatedCredential = await page.waitForSelector(
                    `#gitUsername_${gitUsername}`,
                    { visible: true }
                );
                expect(updatedCredential).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should cancel deleting a git credential in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#gitCredentials');

                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await init.pageClick(page, '#deleteCredentialBtn_0');

                await page.waitForSelector('#cancelCredentialDeleteBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#cancelCredentialDeleteBtn');
                await page.waitForSelector('#deleteCredentialModal', {
                    hidden: true,
                });
                const finalTableRow = await page.$$('tbody tr');

                expect(initialTableRow.length).toEqual(finalTableRow.length);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a git credential in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#gitCredentials');

                await page.waitForSelector('tbody tr', { visible: true });
                const initialTableRow = await page.$$('tbody tr');
                await init.pageClick(page, '#deleteCredentialBtn_0');

                await page.waitForSelector('#deleteCredentialBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#deleteCredentialBtn');
                await page.waitForSelector('#deleteCredentialModal', {
                    hidden: true,
                });
                const finalTableRow = await page.$$('tbody tr');

                expect(initialTableRow.length).toBeGreaterThan(
                    finalTableRow.length
                );
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should cancel adding docker credential to a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');
                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await init.pageClick(page, '#addCredentialBtn');

                await page.waitForSelector('#dockerCredentialForm', {
                    visible: true,
                });
                await page.$eval('#cancelCredentialModalBtn', e => e.click());
                await page.waitForSelector('#dockerCredentialForm', {
                    hidden: true,
                });
                const finalTableRow = await page.$$('tbody tr');

                expect(initialTableRow.length).toEqual(finalTableRow.length);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should add a docker credential to a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');
                await page.waitForSelector('#addCredentialBtn', {
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

                const credentialModalForm = await page.waitForSelector(
                    '#dockerCredentialForm',
                    { hidden: true }
                );
                expect(credentialModalForm).toBeNull();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should update a docker credential',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');

                await page.waitForSelector('#editCredentialBtn_0');
                await init.pageClick(page, '#editCredentialBtn_0');
                await page.waitForSelector('#dockerCredentialForm');
                const dockerUsername = 'username';
                const dockerPassword = 'hello1234567890';
                await init.pageClick(page, '#dockerUsername', { clickCount: 3 });
                await init.pageType(page, '#dockerUsername', dockerUsername);
                await init.pageClick(page, '#dockerPassword', { clickCount: 3 });
                await init.pageType(page, '#dockerPassword', dockerPassword);
                await init.pageClick(page, '#updateCredentialModalBtn');
                await page.waitForSelector('#dockerCredentialForm', {
                    hidden: true,
                });

                const updatedCredential = await page.waitForSelector(
                    `#dockerUsername_${dockerUsername}`,
                    { visible: true }
                );
                expect(updatedCredential).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not update a docker credential if username or password is invalid',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');

                await page.waitForSelector('#editCredentialBtn_0');
                await init.pageClick(page, '#editCredentialBtn_0');
                await page.waitForSelector('#dockerCredentialForm');
                const dockerUsername = 'invalidusername';
                const dockerPassword = 'hello1234567890';
                await init.pageClick(page, '#dockerUsername', { clickCount: 3 });
                await init.pageType(page, '#dockerUsername', dockerUsername);
                await init.pageClick(page, '#dockerPassword', { clickCount: 3 });
                await init.pageType(page, '#dockerPassword', dockerPassword);
                await init.pageClick(page, '#updateCredentialModalBtn');

                const updateCredentialError = await page.waitForSelector(
                    '#updateCredentialError',
                    { visible: true, timeout: operationTimeOut }
                );
                expect(updateCredentialError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a docker credential to a project if username or password is invalid',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#addCredentialBtn');

                await page.waitForSelector('#dockerCredentialForm', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerRegistryUrl');
                await init.pageType(page, '#dockerRegistryUrl', dockerRegistryUrl);
                await init.pageClick(page, '#dockerUsername');
                await init.pageType(page, '#dockerUsername', 'randomusername');
                await init.pageClick(page, '#dockerPassword');
                await init.pageType(page, '#dockerPassword', 'invalidpassword');
                await init.pageClick(page, '#addCredentialModalBtn');

                const addCredentialError = await page.waitForSelector(
                    '#addCredentialError',
                    { visible: true, timeout: operationTimeOut }
                );
                expect(addCredentialError).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should cancel deleting a docker credential in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');

                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await init.pageClick(page, '#deleteCredentialBtn_0');

                await page.waitForSelector('#cancelCredentialDeleteBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#cancelCredentialDeleteBtn');
                await page.waitForSelector('#deleteCredentialModal', {
                    hidden: true,
                });
                const finalTableRow = await page.$$('tbody tr');

                expect(initialTableRow.length).toEqual(finalTableRow.length);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a docker credential in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await init.pageClick(page, '#projectSettings');
                await page.waitForSelector('#more');
                await init.pageClick(page, '#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await init.pageClick(page, '#dockerCredentials');

                await page.waitForSelector('tbody tr', { visible: true });
                const initialTableRow = await page.$$('tbody tr');
                await init.pageClick(page, '#deleteCredentialBtn_0');

                await page.waitForSelector('#deleteCredentialBtn', {
                    visible: true,
                });
                await init.pageClick(page, '#deleteCredentialBtn');
                await page.waitForSelector('#deleteCredentialModal', {
                    hidden: true,
                });
                const finalTableRow = await page.$$('tbody tr');

                expect(initialTableRow.length).toBeGreaterThan(
                    finalTableRow.length
                );
            });
            done();
        },
        operationTimeOut
    );
});
