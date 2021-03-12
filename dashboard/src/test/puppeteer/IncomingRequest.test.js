const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const incidentRequest = {
    name: 'pyInt',
    incidentTitle: 'Test Incident',
    incidentType: 'offline',
    incidentDescription:
        'This is a sample incident to test incoming http request',
};

describe('Incoming HTTP Request', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
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
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should configure incoming http request to create incident in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#integrations', { visible: true });
                await page.click('#integrations');

                await page.waitForSelector('#addIncomingRequestBtn', {
                    visible: true,
                });
                await page.click('#addIncomingRequestBtn');
                await page.waitForSelector('#name', { visible: true });
                await page.click('#name');
                await page.type('#name', incidentRequest.name);
                await page.$eval('#createIncident', elem => elem.click());
                await page.waitForSelector('#isDefault', { visible: true });
                await page.$eval('#isDefault', elem => elem.click());
                await page.click('#advancedOptionsBtn');
                await page.waitForSelector('#incidentTitle', { visible: true });
                await page.click('#incidentTitle');
                await page.type(
                    '#incidentTitle',
                    incidentRequest.incidentTitle
                );
                await page.click('#incidentDescription');
                await page.type(
                    '#incidentDescription',
                    incidentRequest.incidentDescription
                );

                await page.click('#createIncomingRequest');
                await page.waitForSelector('#createIncomingRequest', {
                    hidden: true,
                });
                await page.waitForSelector('#requestOkBtn', { visible: true });
                await page.click('#requestOkBtn');
                await page.waitForSelector('#requestOkBtn', { hidden: true });

                const firstIncomingHttpRequest = await page.waitForSelector(
                    '#copyIncomingRequestBtn_0',
                    { visible: true }
                );
                expect(firstIncomingHttpRequest).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should update an incoming http request in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#integrations', { visible: true });
                await page.click('#integrations');

                await page.waitForSelector('#editIncomingRequestBtn_0', {
                    visible: true,
                });
                await page.click('#editIncomingRequestBtn_0');
                await page.waitForSelector('#name', { visible: true });
                await page.click('#name', { clickCount: 3 });
                // change the name of the incoming http request
                await page.type('#name', 'newName');
                await page.click('#editIncomingRequest');
                await page.waitForSelector('#editIncomingRequest', {
                    hidden: true,
                });

                const updatedRequest = await page.waitForSelector(
                    '#incomingRequest_newName',
                    { visible: true }
                );
                expect(updatedRequest).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete an incoming http request in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#integrations', { visible: true });
                await page.click('#integrations');

                await page.waitForSelector('#deleteIncomingRequestBtn_0', {
                    visible: true,
                });
                await page.click('#deleteIncomingRequestBtn_0');
                await page.waitForSelector('#deleteIncomingRequestBtn', {
                    visible: true,
                });
                await page.click('#deleteIncomingRequestBtn');
                await page.waitForSelector('#deleteIncomingRequestBtn', {
                    hidden: true,
                });

                const noIncomingRequest = await page.waitForSelector(
                    '#noIncomingRequest',
                    { visible: true }
                );
                expect(noIncomingRequest).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );
});
