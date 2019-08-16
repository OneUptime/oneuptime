const puppeteer = require('puppeteer');
var utils = require('./test-utils');
var should = require('should');
var init = require('./test-init');


let browser, page, userCredentials;

let password = utils.generateRandomString(); 

let email = utils.generateRandomBusinessEmail();

let testFeedback = 'test feedback';



describe('User Feedback', () => {
    
    beforeAll(async () => {
        jest.setTimeout(100000);
        projectId = await localStorage.getItem('id');
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
    });
    
    afterAll(async () => {
        await browser.close();
    });

    it('should send feedback from the dashboard', async (done) => {
        await page.reload({ waitUntil: 'networkidle2' });
        await page.click('#feedback-div', {clickCount: 2});
        await page.type('textarea[name="feedback"]', testFeedback);
        await page.click('#feedback-button');
        await page.waitFor(3000);
        var feedbackMessage = await page.$eval('#feedback-div', el => el.textContent);
        expect(feedbackMessage).toEqual('Thank you for your feedback.');
        done();
    }, 16000);

});