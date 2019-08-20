const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser, page, userCredentials;

let email;
let password = utils.generateRandomString();
let project = utils.generateRandomString();


describe('Project API', () => {
    const operationTimeOut = 20000;
    beforeAll(async (done) => {
        jest.setTimeout(150000);
        browser = await puppeteer.launch({headless:utils.headlessMode});
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
    
        // intercept request and mock response for login
        await page.setRequestInterception(true);
        await page.on('request', async (request)=>{
            if((await request.url()).match(/user\/login/)){
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            }else{
                request.continue();
            }
        });
        await page.on('response', async (response)=>{
            try{
                var res = await response.json();
                if(res && res.tokens){
                    userCredentials = res;
                }
            }catch(error){}
        });
    
        // user credentials
        let email = utils.generateRandomBusinessEmail();
        let password = utils.generateRandomString();
        const user = {
            email,
            password
        };
    
        // register and signin user
        await init.registerUser(user, page);
        await init.loginUser(user, page);
    
        done();
    });
    
    afterAll(async (done) => {
        await browser.close();
        done();
    });

    it('Should create new project from dropdown after login', async (done) => {
        await page.waitForSelector('#selector');
        await page.$eval('#create-project', e => e.click());

        await page.waitFor(1000);
        await page.waitForSelector('#name');
        await page.click('input[id=name]');
        await page.type('input[id=name]', utils.generateRandomString());
        await page.click('input[id=Basic_Month]');
        await page.click('button[type=submit]');
        await page.waitFor(2000);
        localStorageData = await page.evaluate(() => {
            let json = {};
            for (let i = 0; i < localStorage.length; i++) {
               const key = localStorage.key(i);
               json[key] = localStorage.getItem(key);
            }
            return json;
         });
        localStorageData.should.have.property('project');
        done();
    }, operationTimeOut);


    it('Should switch project using project switcher', async (done) => {
        await page.reload({ waitUntil: 'networkidle2'});
        await page.waitForSelector('#AccountSwitcherId');
        await page.click('#AccountSwitcherId');
        await page.waitForSelector('#accountSwitcher');
        const element = await page.$('#accountSwitcher > div[title="Unnamed Project"]');
        await element.click();
        await page.waitFor(5000);
        localStorageData = await page.evaluate(() => {
            let json = {};
            for (let i = 0; i < localStorage.length; i++) {
               const key = localStorage.key(i);
               json[key] = localStorage.getItem(key);
            }
            return json;
         });
        localStorageData.should.have.property('project');
        done();
    }, operationTimeOut);

});