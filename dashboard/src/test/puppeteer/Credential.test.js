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
            await init.loginUser(user, page);
            done();
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should can adding a git credential to a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#gitCredential', { visible: true });
                await page.click('#gitCredential');
                await page.waitForSelector('.ball-beat', { hidden: true });
                const initialTableRow = await page.$$('tbody tr');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

                await page.waitForSelector('#gitCredentialModal', {
                    visible: true,
                });
                await page.click('#cancelCredentialModalBtn');

                await page.waitForSelector('#gitCredentialModal', {
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
            const gitUsername = 'randomUsername';
            const gitPassword = 'randomPassword';

            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#gitCredential', { visible: true });
                await page.click('#gitCredential');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

                await page.waitForSelector('#gitCredentialModal', {
                    visible: true,
                });
                await page.click('#gitUsername');
                await page.type('#gitUsername', gitUsername);
                await page.click('#gitPassword');
                await page.type('#gitPassword', gitPassword);
                await page.click('#addCredentialModalBtn');

                const credentialModal = await page.waitForSelector(
                    '#gitCredentialModal',
                    { hidden: true }
                );
                expect(credentialModal).toBeNull();
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
                await page.waitForSelector('#gitCredential', { visible: true });
                await page.click('#gitCredential');

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
        'should add a docker credential to a project',
        async done => {
            const dockerRegistryUrl = 'https://registry.hub.docker.com';
            const dockerUsername = 'randomUsername';
            const dockerPassword = 'randomPassword';

            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#dockerCredential', {
                    visible: true,
                });
                await page.click('#dockerCredential');
                await page.waitForSelector('#addCredentialBtn', {
                    visible: true,
                });
                await page.click('#addCredentialBtn');

                await page.waitForSelector('#dockerCredentialModal', {
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
        'should delete a docker credential in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#dockerCredential', {
                    visible: true,
                });
                await page.click('#dockerCredential');

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
