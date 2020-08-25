const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');
const {incidentDefaultSettings} = require('../../../../backend/backend/config/incidentDefaultSettings')
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const newDefaultIncidentTitle = 'TEST: {{monitorName}}';
const newDefaultIncidentDescription = 'TEST: {{incidentType}}';
const incidentType = 'offline';
const inctidentTitleAfterSubstitution = `TEST: ${monitorName}`
const inctidentDescriptionAfterSubstitution = `TEST: ${incidentType}`

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
            await init.addMonitorToComponent(componentName, monitorName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should fill title/description fields with default values.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');
                await page.waitForSelector('input[name=title]');
                await page.waitFor(3000);
                const titleFieldValue = await page.$eval('input[name=title]', e => e.value);
                expect(titleFieldValue).toEqual(incidentDefaultSettings.title);
                const descriptionFieldValue = await page.$eval('.ace_layer.ace_text-layer', e => e.textContent);
                expect(descriptionFieldValue).toEqual(incidentDefaultSettings.description);
            });
        },
        operationTimeOut
    );

    test(
      'Should update default title/description fields',
      async () => {
          return await cluster.execute(null, async ({ page }) => {
              await page.goto(utils.DASHBOARD_URL, {
                  waitUntil: 'networkidle0',
              });
              await page.waitForSelector('#projectSettings');
              await page.click('#projectSettings');
              await page.waitForSelector('#incidentSettings');
              await page.click('#incidentSettings');
              await page.waitForSelector('input[name=title]');
              await page.waitFor(3000);
              await page.click('input[name=title]',{clickCount: 3});
              await page.keyboard.press('Backspace');
              await page.type('input[name=title]', newDefaultIncidentTitle);
              
              await page.click('#ace-editor');
              await page.keyboard.down('Control');
              await page.keyboard.press('A');
              await page.keyboard.up('Control');
              await page.type('#ace-editor', newDefaultIncidentDescription);
              await page.click('#saveButton');
              await page.reload({
                waitUntil: 'networkidle0',
              });
              await page.waitFor(3000);
              await page.waitForSelector('input[name=title]');
              const titleFieldValue = await page.$eval('input[name=title]', e => e.value);
              expect(titleFieldValue).toEqual(newDefaultIncidentTitle);
              const descriptionFieldValue = await page.$eval('.ace_layer.ace_text-layer', e => e.textContent);
              expect(descriptionFieldValue).toEqual(newDefaultIncidentDescription);
          });
      },
      operationTimeOut
  );

  test(
    'Should fill title/description fields on the incident creation form with the default values',
    async () => {
      return await cluster.execute(null, async ({ page }) => {
        await init.navigateToMonitorDetails(componentName, monitorName, page);
        await page.waitForSelector(`#createIncident_${monitorName}`);
        await page.click(`#createIncident_${monitorName}`);
        await page.waitForSelector('#title');
        await page.waitFor(3000);
        const titleFieldValue = await page.$eval('#title', e => e.value);
        expect(titleFieldValue).toEqual(newDefaultIncidentTitle);
        const descriptionFieldValue = await page.$eval('.ace_layer.ace_text-layer', e => e.textContent);
        expect(descriptionFieldValue).toEqual(newDefaultIncidentDescription);
        await init.selectByText('#incidentType', incidentType, page);
        await page.click('#createIncident');
        await page.waitForSelector('#closeIncident_0');
        await page.click('#closeIncident_0');
      })
    },
    operationTimeOut
  );

  test(
    'Should substitute variables in title/description when an incident is created',
    async () => {
      return await cluster.execute(null, async ({ page }) => {
        await init.navigateToMonitorDetails(componentName, monitorName, page);
        await page.waitForSelector('tr.incidentListItem:first-of-type > td:nth-of-type(3)');
        await page.click('tr.incidentListItem:first-of-type > td:nth-of-type(3)');
        await page.waitForSelector('#title');
        const title = await page.$eval('#title', e => e.textContent);
        const description = await page.$eval('#description', e => e.textContent);
        expect(title).toEqual(inctidentTitleAfterSubstitution);
        expect(description).toEqual(inctidentDescriptionAfterSubstitution);
      })
    },
    operationTimeOut
  );

});
