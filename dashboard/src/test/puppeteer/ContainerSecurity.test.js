const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const component = 'TestComponent';
const containerSecurityName = 'Test';

describe('Container Security Page', () => {
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
        'should add container security',
        async done => {
            const dockerRegistryUrl = utils.dockerCredential.dockerRegistryUrl;
            const dockerUsername = utils.dockerCredential.dockerUsername;
            const dockerPassword = utils.dockerCredential.dockerPassword;
            const imagePath = utils.dockerCredential.imagePath;
            const imageTags = utils.dockerCredential.imageTags;
            await cluster.execute(null, async ({ page }) => {
                await init.addComponent(component, page);

                await page.waitForSelector('#security', { visible: true });
                await page.click('#security');
                await page.waitForSelector('#container', {
                    visible: true,
                });
                await page.click('#container');

                await page.waitForSelector('#containerSecurityForm', {
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
                await page.waitForSelector('#dockerCredentialForm', {
                    hidden: true,
                });

                await page.click('#name');
                await page.type('#name', containerSecurityName);
                await page.click('#dockerCredential');
                await page.type('#dockerCredential', dockerRegistryUrl);
                await page.keyboard.press('Enter');
                await page.click('#imagePath');
                await page.type('#imagePath', imagePath);
                await page.click('#imageTags');
                await page.type('#imageTags', imageTags);
                await page.click('#addContainerBtn');

                await page.waitForSelector('.ball-beat', { hidden: true });
                const containerSecurity = await page.waitForSelector(
                    `#containerSecurityHeader_${containerSecurityName}`,
                    { visible: true }
                );
                expect(containerSecurity).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );
});
