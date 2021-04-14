const utils = require('./test-utils');
const puppeteer = require('puppeteer');
const init = require('./test-init');


let page, browser;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const projectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();

describe('Check status-page up', () => {
    beforeAll(async done => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test('should load status page and show status page is not present', async done => {
        await page.goto(`${utils.STATUSPAGE_URL}/fakeStatusPageId`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForTimeout(2000);
        const response = await page.$eval('#app-loading > div', e => {
            return e.innerHTML;
        });
        expect(response).toBe('Page Not Found');
        done();
    }, 30000);

    test('should create a status-page', async done => {
        await init.registerUser(user, page);
        await init.renameProject(projectName, page);
        
        // Create a Status-Page with a Manual Monitor and Display the Monitor in Status-Page Url
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        
        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
        await page.click(`#btnCreateStatusPage_${projectName}`);
        await page.waitForSelector('#name');
        await page.click('input[id=name]');
        await page.type('input[id=name]', statusPageName);
        await page.click('#btnCreateStatusPage');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        await page.waitForSelector(`#header-${statusPageName}`);

         // To confirm the status-page name.
         let spanElement = await page.waitForSelector(`#header-${statusPageName}`);
         spanElement = await spanElement.getProperty(
             'innerText'
         );
         spanElement = await spanElement.jsonValue();
         expect(spanElement).toMatch(statusPageName);
        
        done();
    }, 200000);

    test('should create a manual monitor', async done =>{
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#components');
        await page.$eval('#components', el => el.click());

        // Fill and submit New Component form
        await page.waitForSelector('#form-new-component');
        await page.click('input[id=name]');
        await page.type('input[id=name]', componentName);
        await page.click('button[type=submit]');

        // Create a Manual Monitor
        await page.waitForSelector('#form-new-monitor',{visible: true});        
        await page.click('input[id=name]', { visible: true });
        await page.type('input[id=name]', monitorName);
        await page.click('[data-testId=type_manual]');
        await page.waitForSelector('#description');
        await page.click('#description');
        await page.type('#description', 'My Manual Monitor');
        await page.click('button[type=submit]');        

        // To confirm the manual monitor is created
        let spanElement = await page.waitForSelector(`#monitor-title-${monitorName}`);
        spanElement = await spanElement.getProperty(
            'innerText'
        );
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    }, 200000);

    test('should add monitor to status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');        
        await page.waitForSelector('#addMoreMonitors');
        await page.click('#addMoreMonitors');
        await init.selectByText('#monitor-name',`${componentName} / ${monitorName}`, page);
        await page.click('#monitor-description');
        await page.type('#monitor-description', 'Status Page Description');
        await page.click('#manual-monitor-checkbox');
        await page.click('#btnAddStatusPageMonitors');

        await page.waitForSelector('#publicStatusPageUrl');
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link);        

        // To confirm the monitor is present in the status-page
        let spanElement = await page.waitForSelector(`#monitor-${monitorName}`);
        spanElement = await spanElement.getProperty(
            'innerText'
        );
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    });
});
