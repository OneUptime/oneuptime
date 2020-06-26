const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Application Security Page', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(operationTimeOut);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions:utils.puppeteerLaunchConfig,
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
        'should create an application security',
        async done => {
            const component = 'TestComponent';
            const gitUsername = utils.gitCredential.gitUsername;
            const gitPassword = utils.gitCredential.gitPassword;
            const gitRepositoryUrl = utils.gitCredential.gitRepositoryUrl;
            const applicationSecurityName = 'Test';

            await cluster.execute(null, async ({ page }) => {
                await init.addComponent(component, page);

                await page.waitForSelector('#security', { visible: true });
                await page.click('#security');
                await page.waitForSelector('#application', { visible: true });
                await page.click('#application');

                await page.waitForSelector('#applicationSecurityForm', {
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
                await page.waitForSelector('#gitCredentialForm', {
                    hidden: true,
                });

                await page.click('#name');
                await page.type('#name', applicationSecurityName);
                await page.click('#gitRepositoryUrl');
                await page.type('#gitRepositoryUrl', gitRepositoryUrl);
                await page.click('#gitCredential');
                await page.type('#gitCredential', gitUsername); // select the created credential
                await page.keyboard.press('Enter'); // Enter Key
                await page.click('#addApplicationBtn');

                await page.waitForSelector('.ball-beat', { hidden: true });
                const applicationSecurity = await page.waitForSelector(
                    `#applicationSecurityHeader_${applicationSecurityName}`,
                    { visible: true }
                );
                expect(applicationSecurity).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should scan an application security',
        async done => {
            const component = 'TestComponent';
            const applicationSecurityName = 'Test';
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                await page.waitForSelector('#component0', { visible: true });
                await page.click(`#more-details-${component}`);
                await page.waitForSelector('#security', { visible: true });
                await page.click('#security');
                await page.waitForSelector('#application', { visible: true });
                await page.click('#application');
                await page.waitForSelector(
                    `#applicationSecurityHeader_${applicationSecurityName}`,
                    { visible: true }
                );
                await page.click(
                    `#scanApplicationSecurity_${applicationSecurityName}`
                );

                const scanning = await page.waitForSelector(
                    `#scanningApplicationSecurity_${applicationSecurityName}`,
                    { hidden: true, timeout: operationTimeOut }
                );
                expect(scanning).toBeNull();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should view details of security log',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                await page.waitForSelector('#component0', { visible: true });
                await page.click(`#more-details-${component}`);
                await page.waitForSelector('#security', { visible: true });
                await page.click('#security');
                await page.waitForSelector('#application', { visible: true });
                await page.click('#application');
                await page.waitForSelector(
                    `#applicationSecurityHeader_${applicationSecurityName}`,
                    { visible: true }
                );
                await page.click(
                    `#moreApplicationSecurity_${applicationSecurityName}`
                );
                const securityLog = await page.waitForSelector('#securityLog', {
                    visible: true,
                });

                expect(securityLog).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should edit an application security',
        async done => {
            const newApplicationName = 'AnotherName';
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#components', { visible: true });
                await page.click('#components');

                await page.waitForSelector('#component0', { visible: true });
                await page.click(`#more-details-${component}`);
                await page.waitForSelector('#security', { visible: true });
                await page.click('#security');
                await page.waitForSelector('#application', { visible: true });
                await page.click('#application');
                await page.waitForSelector(
                    `#applicationSecurityHeader_${applicationSecurityName}`,
                    { visible: true }
                );
                await page.click(
                    `#moreApplicationSecurity_${applicationSecurityName}`
                );

                await page.waitForSelector(`#edit_${applicationSecurityName}`, {
                    visible: true,
                });
                await page.click(`#edit_${applicationSecurityName}`);
                await page.waitForSelector('#editApplicationSecurityForm', {
                    visible: true,
                });
                await page.click('#name', { clickCount: 3 });
                await page.type('#name', newApplicationName);
                await page.click('#editApplicationBtn');
                await page.waitForSelector('#editApplicationSecurityForm', {
                    hidden: true,
                });

                const textContent = await page.$eval(
                    `#applicationSecurityTitle_${newApplicationName}`,
                    elem => elem.textContent
                );
                expect(textContent).toEqual(newApplicationName);
            });
            done();
        },
        operationTimeOut
    );
});
