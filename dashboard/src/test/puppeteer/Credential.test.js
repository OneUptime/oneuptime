const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Credential Page', () => {
    const operationTimeOut = 500000;
    const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
    const dockerUsername = utils.dockerCredential.dockerUsername;
    const dockerPassword = utils.dockerCredential.dockerPassword;
    const gitUsername = utils.gitCredential.gitUsername;
    const gitPassword = utils.gitCredential.gitPassword;

    let cluster;
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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });                
                await page.click('#gitCredentials');
                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await page.click('#gitCredentials');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

                await page.waitForSelector('#gitCredentialForm', {
                    visible: true,
                });
                await page.click('#gitUsername');
                await page.type('#gitUsername', gitUsername);
                await page.click('#gitPassword');
                await page.type('#gitPassword', gitPassword);
                await page.click('#addCredentialModalBtn');

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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await page.click('#gitCredentials');

                await page.waitForSelector('#editCredentialBtn_0', {
                    visible: true,
                });
                await page.click('#editCredentialBtn_0');
                await page.waitForSelector('#gitCredentialForm');
                const gitUsername = 'newusername';
                await page.click('#gitUsername', { clickCount: 3 });
                await page.type('#gitUsername', gitUsername);
                await page.click('#updateCredentialModalBtn');
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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await page.click('#gitCredentials');

                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.click('#deleteCredentialBtn_0');

                await page.waitForSelector('#cancelCredentialDeleteBtn', {
                    visible: true,
                });
                await page.click('#cancelCredentialDeleteBtn');
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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#gitCredentials', {
                    visible: true,
                });
                await page.click('#gitCredentials');

                await page.waitForSelector('tbody tr', { visible: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.click('#deleteCredentialBtn_0');

                await page.waitForSelector('#deleteCredentialBtn', {
                    visible: true,
                });
                await page.click('#deleteCredentialBtn');
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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');
                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.click('#addCredentialBtn');

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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

                await page.waitForSelector('#dockerCredentialForm', {
                    visible: true,
                });
                await page.click('#dockerRegistryUrl');
                await page.type('#dockerRegistryUrl', dockerRegistryUrl);
                await page.click('#dockerUsername');
                await page.type('#dockerUsername', dockerUsername);
                await page.click('#dockerPassword');
                await page.type('#dockerPassword', dockerPassword);
                await page.click('#addCredentialModalBtn');

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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');

                await page.waitForSelector('#editCredentialBtn_0');
                await page.click('#editCredentialBtn_0');
                await page.waitForSelector('#dockerCredentialForm');
                const dockerUsername = 'username';
                const dockerPassword = 'hello1234567890';
                await page.click('#dockerUsername', { clickCount: 3 });
                await page.type('#dockerUsername', dockerUsername);
                await page.click('#dockerPassword', { clickCount: 3 });
                await page.type('#dockerPassword', dockerPassword);
                await page.click('#updateCredentialModalBtn');
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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');

                await page.waitForSelector('#editCredentialBtn_0');
                await page.click('#editCredentialBtn_0');
                await page.waitForSelector('#dockerCredentialForm');
                const dockerUsername = 'invalidusername';
                const dockerPassword = 'hello1234567890';
                await page.click('#dockerUsername', { clickCount: 3 });
                await page.type('#dockerUsername', dockerUsername);
                await page.click('#dockerPassword', { clickCount: 3 });
                await page.type('#dockerPassword', dockerPassword);
                await page.click('#updateCredentialModalBtn');

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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

                await page.waitForSelector('#dockerCredentialForm', {
                    visible: true,
                });
                await page.click('#dockerRegistryUrl');
                await page.type('#dockerRegistryUrl', dockerRegistryUrl);
                await page.click('#dockerUsername');
                await page.type('#dockerUsername', 'randomusername');
                await page.click('#dockerPassword');
                await page.type('#dockerPassword', 'invalidpassword');
                await page.click('#addCredentialModalBtn');

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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');

                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.click('#deleteCredentialBtn_0');

                await page.waitForSelector('#cancelCredentialDeleteBtn', {
                    visible: true,
                });
                await page.click('#cancelCredentialDeleteBtn');
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
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#dockerCredentials', {
                    visible: true,
                });
                await page.click('#dockerCredentials');

                await page.waitForSelector('tbody tr', { visible: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.click('#deleteCredentialBtn_0');

                await page.waitForSelector('#deleteCredentialBtn', {
                    visible: true,
                });
                await page.click('#deleteCredentialBtn');
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
