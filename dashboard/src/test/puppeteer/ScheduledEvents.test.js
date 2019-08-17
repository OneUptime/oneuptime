const puppeteer = require('puppeteer');
var utils = require('./test-utils');
var should = require('should');
var init = require('./test-init');


let browser, page, userCredentials;

let email;
let password = utils.generateRandomString(); 


describe('Scheduled event', () => {
    const operationTimeOut = 50000;

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
    

    it('should create a new scheduled event for a monitor', async() => {
        
        let monitorName = utils.generateRandomString();
        await page.waitForSelector('#monitors');

        await page.click('#monitors');

        await page.waitForSelector('#frmNewMonitor');

        await page.click('input[id=name]');

        await page.type('input[id=name]', monitorName);

        await page.select('select[name=type_1000]','url');

        await page.waitForSelector('#url');

        await page.click('#url');

        await page.type('#url', 'https://google.com');

        await page.click('button[type=submit]');

        await page.waitFor(5000);

        moreButtonSelector= `#more_details_${monitorName}`;
        await page.click(moreButtonSelector);
        
        await page.waitFor(2000);

        addButtonSelector = '#addScheduledEventButton';
        await page.click(addButtonSelector);

        await page.waitFor(1000);

        await page.type('input[name=name]', utils.scheduledEventName);
        await page.type('textarea[name=description]', utils.scheduledEventDescription);

        await page.evaluate(() => {
            document.querySelector('input[name=showEventOnStatusPage]').click();
          });

        await page.click('#createScheduledEventButton');
        

        createdScheduledEventSelector='#scheduledEventsList > div > div.bs-ObjectList-cell.bs-u-v-middle.bs-ActionsParent.db-ListViewItem--hasLink > div.Text-color--cyan.Text-display--inline.Text-fontSize--14.Text-fontWeight--medium.Text-lineHeight--20.Text-typeface--base.Text-wrap--wrap';
        await page.waitFor(1000);
        var createdScheduledEventName = await page.$eval(createdScheduledEventSelector, el => el.textContent);
        expect(createdScheduledEventName).toEqual(utils.scheduledEventName);
        
        
    }, operationTimeOut);

    it('should update the created scheduled event for a monitor', async() => {
        
        createdScheduledEventSelector='#scheduledEventsList > div > div.bs-ObjectList-cell.bs-u-v-middle.bs-ActionsParent.db-ListViewItem--hasLink > div.Text-color--cyan.Text-display--inline.Text-fontSize--14.Text-fontWeight--medium.Text-lineHeight--20.Text-typeface--base.Text-wrap--wrap';
        await page.click(createdScheduledEventSelector);

        await page.waitFor(1000);

        await page.click('input[name=name]', {clickCount: 3})
        await page.keyboard.press('Backspace')
        await page.type('input[name=name]', utils.updatedScheduledEventName);

        await page.click('textarea[name=description]', {clickCount: 3})
        await page.keyboard.press('Backspace')
        await page.type('textarea[name=description]', utils.updatedScheduledEventDescription);

        await page.evaluate(() => {
            document.querySelector('input[name=showEventOnStatusPage]').click();
          });
        await page.evaluate(() => {
        document.querySelector('input[name=alertSubscriber]').click();
        });
        
        await page.click('#updateScheduledEventButton');

        await page.waitFor(1000);
        var createdScheduledEventName = await page.$eval(createdScheduledEventSelector, el => el.textContent);
        expect(createdScheduledEventName).toEqual(utils.updatedScheduledEventName);
        
        
    }, operationTimeOut);

    it('should delete the created scheduled event for a monitor', async() => {


        var deleteButtonSelector = '#scheduledEventsList > div > div:nth-child(5) > button'
        
        await page.click(deleteButtonSelector);
        
        await page.waitFor(1000);

        var scheduledEventCounterSelector = '#scheduledEventCount'
        var scheduledEventCount = await page.$eval(scheduledEventCounterSelector, el => el.textContent);
        
        expect(scheduledEventCount).toEqual("0 Scheduled Event");
        
    }, operationTimeOut);
});