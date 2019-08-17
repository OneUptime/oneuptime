const puppeteer = require('puppeteer');
const should = require('should');
const utils = require('./test-utils');
const init = require('./test-init');

let browser, page, frame, userCredentials;



describe('Stripe cards API', () => {
    beforeAll(async () => {
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
    });
    
    afterAll(async () => {
        await browser.close();
    });
    
    it('should add a valid card', async () => {
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#billing');
        await page.click('#billing');
        await page.waitForSelector('#addCardButton');
        await page.click('#addCardButton');
        await page.waitFor(3000);
        await page.waitForSelector('iframe[name=__privateStripeFrame5]');
        frame = await page.$('iframe[name=__privateStripeFrame5]');
        frame = await frame.contentFrame();
        frame.waitForSelector('input[name=cardnumber]');
        await frame.type('input[name=cardnumber]', '6011111111111117', {
            delay:50
        });
        frame.waitForSelector('input[name=exp-date]');
        await frame.type('input[name=exp-date]', '1123' );
        frame.waitForSelector('input[name=cvc]');
        await frame.type('input[name=cvc]', '100' );
        frame.waitForSelector('input[name=postal]');
        await frame.type('input[name=postal]', '11234' );
        await page.click('#addCardButtonSubmit');
        await page.waitFor(10000);
        var cardsCount = await page.$eval('#cardsCount', el => el.textContent);
        expect(cardsCount).toEqual('2 Cards');
    }, 50000);
    it('should delete card', async () => {
        await page.click('#deleteCard1');
        await page.waitForSelector('#deleteCardButton');
        await page.click('#deleteCardButton');
        await page.waitFor(4000);
        var cardsCount = await page.$eval('#cardsCount', el => el.textContent);
        expect(cardsCount).toEqual('1 Card');
    }, 50000);
    it('should not delete card when there is only one card left', async () => {
        await page.click('#deleteCard0');
        await page.waitForSelector('#deleteCardButton');
        await page.click('#deleteCardButton');
        await page.waitFor(4000);
        await page.click('#deleteCardCancel');
        var cardsCount = await page.$eval('#cardsCount', el => el.textContent);
        expect(cardsCount).toEqual('1 Card');
    }, 50000);
    it('should not add an invalid card', async () => {
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#billing');
        await page.click('#billing');
        await page.waitForSelector('#addCardButton');
        await page.click('#addCardButton');
        await page.waitFor(2000);
        await page.waitForSelector('iframe[name=__privateStripeFrame10]');
        frame = await page.$('iframe[name=__privateStripeFrame10]');
        frame = await frame.contentFrame();
        frame.waitForSelector('input[name=cardnumber]');
        await frame.type('input[name=cardnumber]', '4242424242424241', {
            delay:20
        });
        frame.waitForSelector('input[name=exp-date]');
        await frame.type('input[name=exp-date]', '1123' );
        frame.waitForSelector('input[name=cvc]');
        await frame.type('input[name=cvc]', '100' );
        frame.waitForSelector('input[name=postal]');
        await frame.type('input[name=postal]', '11234' );
        await page.click('#addCardButtonSubmit');
    }, 50000);
});

