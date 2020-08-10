const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

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
    });
  });

  afterAll(async () => {
    await cluster.idle();
    await cluster.close();
  });

  test(
    'Should create incident priority.',
    async () => {
      return await cluster.execute(null, async ({ page }) => {
        await page.goto(utils.DASHBOARD_URL, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#incidentSettings');
        await page.click('#incidentSettings');
        await page.waitForSelector('#addNewPriority');
        await page.click('#addNewPriority');
        await page.waitForSelector('#CreateIncidentPriority');
        await page.type('input[name=name]','High');
        await page.click('#CreateIncidentPriority');
        await page.waitFor(3000);
        await page.reload({
          waitUntil: 'networkidle0',
        });
        const firstRowFirstColumnIndentifier= '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row>div:first-child';
        await page.waitForSelector(firstRowFirstColumnIndentifier);
        const content = await page.$eval(firstRowFirstColumnIndentifier, e=> e.textContent)
        expect(content).toEqual('High');
      })
    },
    operationTimeOut
  );

  test(
    'Should edit incident priority.',
    async () => {
      return await cluster.execute(null, async ({ page }) => {
        await page.goto(utils.DASHBOARD_URL, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#incidentSettings');
        await page.click('#incidentSettings');
        const editButtonFirstRowIndentifier= '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row>div:nth-child(2)>div>div:first-child>button';
        await page.waitForSelector(editButtonFirstRowIndentifier);
        await page.click(editButtonFirstRowIndentifier);
        await page.waitForSelector('#EditIncidentPriority');
        await page.click('input[name=name]',{clickCount:3});
        await page.keyboard.press('Backspace');
        await page.type('input[name=name]','Medium');
        await page.click('#EditIncidentPriority');
        await page.waitFor(3000);
        await page.reload({
          waitUntil: 'networkidle0',
        });
        const firstRowIndentifier= '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row>div:first-child';
        await page.waitForSelector(firstRowIndentifier);
        const content = await page.$eval(firstRowIndentifier, e=> e.textContent)
        expect(content).toEqual('Medium');
      })
    },
    operationTimeOut
  );

  test(
    'Should delete incident priority.',
    async () => {
      return await cluster.execute(null, async ({ page }) => {
        await page.goto(utils.DASHBOARD_URL, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#incidentSettings');
        await page.click('#incidentSettings');
        await page.waitFor(3000);
        const incidentPrioritiesCount='#incidentPrioritiesCount';
        await page.waitForSelector(incidentPrioritiesCount);
        const incidentsCountBeforeDeletion = await page.$eval(incidentPrioritiesCount, e => e.textContent);
        expect(incidentsCountBeforeDeletion).toEqual('1 Priority');
        const deleteButtonFirstRowIndentifier= '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row>div:nth-child(2)>div>div:nth-child(2)>button';
        await page.click(deleteButtonFirstRowIndentifier);
        await page.waitForSelector('#RemoveIncidentPriority');
        await page.click('#RemoveIncidentPriority');
        await page.waitFor(3000);
        await page.reload({
          waitUntil: 'networkidle0',
        });
        await page.waitFor(3000);
        const incidentsCountAfterDeletion = await page.$eval(incidentPrioritiesCount, e => e.textContent);
        expect(incidentsCountAfterDeletion).toEqual('0 Priorities');

      })
    },
    operationTimeOut
  );

  test(
    'Should add multiple incidents and paginate priorities list.',
    async () => {
      return await cluster.execute(null, async ({ page }) => {
        await page.goto(utils.DASHBOARD_URL, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#incidentSettings');
        await page.click('#incidentSettings');
        const incidentPrioritiesCountIdentifier='#incidentPrioritiesCount';
        await page.waitForSelector(incidentPrioritiesCountIdentifier);
        let incidentPrioritiesCount = await page.$eval(incidentPrioritiesCountIdentifier,e=>e.textContent);
        expect(incidentPrioritiesCount).toEqual('0 Priorities');

        for(let i=0;i<11;i++){
          await page.waitForSelector('#addNewPriority');
          await page.click('#addNewPriority');
          await page.waitForSelector('#CreateIncidentPriority');
          await page.type('input[name=name]','High');
          await page.click('#CreateIncidentPriority');
        }

        await page.reload({
          waitUntil: 'networkidle0',
        });
        await page.waitFor(3000);

        await page.waitForSelector('#btnNext');
        await page.click('#btnNext');
        await page.waitFor(3000);
        incidentPrioritiesCount = await page.$eval(incidentPrioritiesCountIdentifier,e=>e.textContent);
        expect(incidentPrioritiesCount).toEqual('1 Priority');

        await page.waitForSelector('#btnPrev');
        await page.click('#btnPrev');
        await page.waitFor(3000);
        incidentPrioritiesCount = await page.$eval(incidentPrioritiesCountIdentifier,e=>e.textContent);
        expect(incidentPrioritiesCount).toEqual('10 Priorities');

      })
    },
    operationTimeOut
  );

});