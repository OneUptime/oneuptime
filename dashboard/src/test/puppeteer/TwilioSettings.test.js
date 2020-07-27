const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const { twilioCredentials } = { ...utils }

const projectName= 'project';
const componentName= 'component 1';
const monitorName= 'monitor 1';

describe('Custom Twilio Settings', () => {
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
            await init.loginUser(user, page);
            await init.addProject(page,projectName);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should create a custom twilio settings',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#email');
                await page.click('#sms');
                await page.waitForSelector('label[for=smssmtpswitch]', { visible: true });
                await page.click('label[for=smssmtpswitch]');
                await page.type('#accountSid', twilioCredentials.accountSid);
                await page.type('#authToken', twilioCredentials.authToken);
                await page.type('#phoneNumber', twilioCredentials.phoneNumber);
                await page.click('#submitTwilioSettings');
                await page.waitFor(3000);
                await page.reload();
                await page.waitForSelector('#accountSid', twilioCredentials.accountSid);
                const savedAccountSid = await page.$eval('#accountSid', elem => elem.value);
                expect(savedAccountSid).toBe(twilioCredentials.accountSid);
            });

            done();
        },
        operationTimeOut
    );

});
