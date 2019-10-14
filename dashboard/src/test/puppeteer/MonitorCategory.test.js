const puppeteer = require('puppeteer');
var utils = require('./test-utils');
var should = require('should');
var init = require('./test-init');


let browser, page, userCredentials;

let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};
let callSchedule = utils.generateRandomString();

describe('Monitor Category', () => {
    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(150000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');

        // intercept request and mock response for login
        await page.setRequestInterception(true);
        await page.on('request', async (request) => {
            if ((await request.url()).match(/user\/login/)) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            } else {
                request.continue();
            }
        });
        await page.on('response', async (response) => {
            try {
                const res = await response.json();
                if (res && res.tokens) {
                    userCredentials = res;
                }
            } catch (error) { }
        });

        await init.registerUser(user, page);
        await init.loginUser(user, page);
    });

    afterAll(async () => {
        await browser.close();
    });


    it('should create a new monitor category', async () => {
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#monitors:nth-of-type(2)');
        await page.click('#monitors:nth-of-type(2)');
        await page.waitForSelector('#createMonitorCategoryButton');
        await page.click('#createMonitorCategoryButton');
        await page.type('#monitorCategoryName', utils.monitorCategoryName);
        await page.click('#addMonitorCategoryButton');
        await page.waitFor(5000);

        var createdMonitorCategorySelector = '#monitorCategoryList > div > div > div:nth-child(2) > div:nth-child(1)'
        var createdMonitorCategoryName = await page.$eval(createdMonitorCategorySelector, el => el.textContent);

        expect(createdMonitorCategoryName).toEqual(utils.monitorCategoryName);
    }, operationTimeOut);


    it('should show created monitor category in new monitor dropdown', async () => {
        await page.waitForSelector('#monitors');
        await page.click('#monitors');
        await page.waitFor(5000);

        let monitorCategoryCheck = false;
        let $monitorCategory = await page.$('#monitorCategory');
        let properties = await $monitorCategory.getProperties();
        for (const property of properties.values()) {
            const element = property.asElement();
            if (element) {
                let hText = await element.getProperty("text");
                let text = await hText.jsonValue();
                if (text === utils.monitorCategoryName) {
                    monitorCategoryCheck = true
                    break;
                }
            }
        }
        expect(monitorCategoryCheck).toEqual(true);
    }, operationTimeOut);


    it('should create a new monitor by selecting monitor category from dropdown', async () => {
        await page.waitForSelector('#monitors');
        await page.click('#monitors');
        await page.waitForSelector('#frmNewMonitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', utils.monitorName);
        await page.select('select[name=type_1000]', 'url');
        await init.selectByText('#monitorCategory', utils.monitorCategoryName, page);
        await page.waitForSelector('#url');
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);

        var createdMonitorSelector = `#monitor_title_${utils.monitorName}`
        var createdMonitorName = await page.$eval(createdMonitorSelector, el => el.textContent);

        expect(createdMonitorName).toEqual(utils.monitorName);
    }, operationTimeOut);

    it('should delete the created monitor category', async () => {
        await page.click('#projectSettings');
        await page.waitForSelector('#monitors:nth-of-type(2)');
        await page.click('#monitors:nth-of-type(2)');

        var deleteButtonSelector = '#monitorCategoryList > div > div > div:nth-child(2) > div:nth-child(3) > button'
        await page.waitForSelector(deleteButtonSelector);
        await page.click(deleteButtonSelector);
        await page.waitFor(1000);

        var monitorCategoryCounterSelector = '#monitorCategoryCount'
        var monitorCategoryCount = await page.$eval(monitorCategoryCounterSelector, el => el.textContent);

        expect(monitorCategoryCount).toEqual("0 Monitor Category");
    }, operationTimeOut);
});
