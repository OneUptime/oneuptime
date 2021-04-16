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

const projectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const subscriberEmail = utils.generateRandomBusinessEmail();
const customDomainWebsite = `www.${utils.generateRandomString()}.com`

describe('Status-Page Advanced Options', ()=>{
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

    test('should create a status-page', async done => {
        await init.registerUser(user, page);
        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page); // Only Month growth plan can enable subscriber in status-page
        
        // Create a Status-Page and Scheduled Maintenance to display in the Status-Page Url
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

        // To confirm the manual monitor is created.
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

        // To confirm the monitor is present in the status-page.
        let spanElement = await page.waitForSelector(`#monitor-${monitorName}`);
        spanElement = await spanElement.getProperty(
            'innerText'
        );
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    }, 200000);

    test('should add subscriber', async done =>{
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await init.navigateToMonitorDetails(monitorName, page);
        // Navigate to subscriber tab in monitor.
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems =>
            elems[1].click()
        );
        await page.waitForSelector('#addSubscriberButton');
        await page.click('#addSubscriberButton');
        await page.waitForSelector('#alertViaId');
        await init.selectByText('#alertViaId', 'Email', page);
        await page.waitForSelector('#emailId');
        await page.click('#emailId');
        await page.type('#emailId', subscriberEmail);
        await page.waitForSelector('#createSubscriber');
        await page.click('#createSubscriber');
        // To confirm that the subscriber is created.
        let subscriberContact = await page.waitForSelector('#subscriber_contact');
        expect(subscriberContact).toBeDefined();

        done();
    },200000);

    test('should view created subscriber on status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        // Navigate to subscriber tab in status-page.
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems =>
            elems[1].click()
        );
         // To confirm that the subscriber created is present.
         let subscriberContact = await page.waitForSelector('#subscriber_contact');
         expect(subscriberContact).toBeDefined();

        done();
    },200000);
    

    test('should create custom domain in status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        // Navigate to custom domain tab in status-page.
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems =>
            elems[2].click()
        );
        await page.waitForSelector('#addMoreDomain');
        await page.click('#addMoreDomain');
        await page.waitForSelector('#customDomain');
        await page.click('#customDomain');
        await page.type('#customDomain', customDomainWebsite);
        await page.click('#createCustomDomainBtn');

        // To confirm that custom domain is created.
        let customDomain = await page.waitForSelector('#publicStatusPageUrl');
        expect(customDomain).toBeDefined();

        done();
    }, 200000);

    test('should enable add subscriber from advanced options and view on status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        // Navigate to advanced tab in status-page
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems =>
            elems[5].click()
        );

        // Add Enable Subscribers
        await page.waitForSelector('#enable-subscribers');
        await page.click('#enable-subscribers');
        await page.waitForSelector('#saveAdvancedOptions');
        await page.click('#saveAdvancedOptions');
        
        await page.waitForSelector('#publicStatusPageUrl');
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link); 
        // To confirm subscribe button is present in status-page
        let subscriberButton = await page.waitForSelector("#subscriber-button");
        expect(subscriberButton).toBeDefined();

        done();
    }, 200000);

    test('should navigate to status-page and add subscriber', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await init.navigateToStatusPage(page);
        await page.waitForSelector('#subscriber-button');
        await page.click('#subscriber-button');
        await page.waitForSelector('input[name=email]');
        await page.click('input[name=email]');
        await page.type('input[name=email]', subscriberEmail);
        await page.click('#subscribe-btn-email');
        // To confirm successful subscription
        let subscribeSuccess = await page.waitForSelector('#monitor-subscribe-success-message');
        subscribeSuccess = await subscribeSuccess.getProperty(
            'innerText'
        );
        subscribeSuccess = await subscribeSuccess.jsonValue();
        expect(subscribeSuccess).toMatch('You have subscribed to this status page successfully');

        done();
    } , 200000);

    test('should delete status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages');
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        // Navigate to advanced tab in status-page
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems =>
            elems[5].click()
        );

        await page.waitForSelector('#delete');
        await page.click('#delete');
        await page.waitForSelector('#confirmDelete');
        await page.click('#confirmDelete');

        // To confirm status-page has been deleted.
        let deletedStatusPage = await page.waitForSelector('#statusPagesListContainer');
        expect(deletedStatusPage).toBeDefined();

        done();
    }, 200000);
    
});