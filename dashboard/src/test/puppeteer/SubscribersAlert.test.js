const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const countryCode = '+1';
const phoneNumber = '9173976235';
const subscriberEmail = utils.generateRandomBusinessEmail();

describe('Incident Priority API', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            await init.addTwilioSettings(
              true,
              utils.twilioCredentials.accountSid,
              utils.twilioCredentials.authToken,
              utils.twilioCredentials.phoneNumber,
              page
            );
            await init.addMonitorToComponent(componentName,monitorName,page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should add SMS subscribers.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await init.navigateToMonitorDetails(componentName,monitorName,page);
                await page.waitForSelector('#addSubscriberButton');
                await page.click('#addSubscriberButton');
                await page.waitForSelector('#alertViaId');
                await init.selectByText('#alertViaId','sms',page);
                await page.waitForSelector('#countryCodeId');
                await init.selectByText('#countryCodeId',countryCode,page);
                await page.type('#contactPhoneId',phoneNumber);
                await page.click('#createSubscriber');
                const subscriberPhoneNumberSelector = '#subscribersList tbody tr:first-of-type td:nth-of-type(4)';
                await page.waitForSelector(subscriberPhoneNumberSelector);
                const subscriberPhoneNumber=await page.$eval(subscriberPhoneNumberSelector, e => e.textContent);
                expect(subscriberPhoneNumber).toEqual(`${countryCode}${phoneNumber}`);
            });
        },
        operationTimeOut
    );

    test(
      'Should add Email subscribers.',
      async () => {
          return await cluster.execute(null, async ({ page }) => {
              await page.goto(utils.DASHBOARD_URL, {
                  waitUntil: 'networkidle0',
              });
              await init.navigateToMonitorDetails(componentName,monitorName,page);
              await page.waitForSelector('#addSubscriberButton');
              await page.click('#addSubscriberButton');
              await page.waitForSelector('#alertViaId');
              await init.selectByText('#alertViaId','email',page);
              await page.waitForSelector('#emailId');
              await page.type('#emailId',subscriberEmail);
              await page.click('#createSubscriber');
              const subscriberEmailSelector = '#subscribersList tbody tr:first-of-type td:nth-of-type(4)';
              await page.waitForSelector(subscriberEmailSelector);
              const renderedSubscriberEmail = await page.$eval(subscriberEmailSelector, e => e.textContent);
              expect(renderedSubscriberEmail).toEqual(subscriberEmail);
          });
      },
      operationTimeOut
  );

});