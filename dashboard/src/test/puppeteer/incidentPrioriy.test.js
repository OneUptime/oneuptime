const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Monitor API', () => {
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
        await page.waitForSelector('#CreateIncidentPrioriy');
        await page.type('input[name=name]','High');
        await page.click('#CreateIncidentPrioriy');
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
        await page.waitForSelector('#EditIncidentPrioriy');
        await page.click('input[name=name]',{clickCount:3});
        await page.keyboard.press('Backspace');
        await page.type('input[name=name]','Medium');
        await page.click('#EditIncidentPrioriy');
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

});