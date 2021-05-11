const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

 let browser, page;
 const user={
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
 }
 const componentName = utils.generateRandomString();
 const monitorName = utils.generateRandomString();

 /** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Monitor Reload', () =>{
     const operationTimeOut = 100000;

     beforeAll(async (done)=>{
        jest.setTimeout(100000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        await init.registerUser(user, page); // This automatically routes to dashboard page
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        await init.addIncident(monitorName, 'Offline', page);
        done();
     });

     afterAll(async (done)=>{
        await browser.close();
        done();
     });    

     test('Should reload the monitor in component-details page and confirm no error', async (done)=>{
       await init.navigateToComponentDetails(componentName, page);
       await page.waitForSelector('#incidentLog', {visible : true});
       await page.click('#incidentLog');
       await page.waitForSelector('#cbIncidents');
       await page.waitForSelector('#incident_title');
       //To confirm no error on page reload
       await page.reload({waitUntil: 'networkidle0'});
       await page.waitForSelector(`#cb${componentName}`, {visible:true});
       await page.waitForSelector('#cbIncidents', {visible:true});       
       let spanElement = await page.waitForSelector(`#incident_title`, {visible : true});      
       expect(spanElement).toBeDefined();

       done();
    }, operationTimeOut);
    
    test('Should navigate to incident detail page and reload to check errors', async (done)=>{
      await init.navigateToComponentDetails(componentName, page);
      await page.waitForSelector('#incidentLog', {visible : true});
      await page.click('#incidentLog');
      await page.waitForSelector(`#incident_${monitorName}_0`);
      await page.click(`#incident_${monitorName}_0`);
      await page.waitForSelector('#incident_0');
      //To confirm no error on page reload
      await page.reload({waitUntil: 'networkidle0'});
      await page.waitForSelector(`#cb${componentName}`, {visible:true});
       await page.waitForSelector('#cbIncidentLog', {visible:true});
      let spanElement = await page.waitForSelector('#incident_0');
      expect(spanElement).toBeDefined();

      done();
    }, operationTimeOut);

    test('Should navigate to incident detail page and reload to check errors', async (done)=>{
      await page.goto(utils.DASHBOARD_URL);
      await page.waitForSelector('#incidents');
      await page.click('#incidents');      
      await page.waitForSelector(`#incident_${monitorName}_0`);
      await page.click(`#incident_${monitorName}_0`);
      await page.waitForSelector('#incident_0');
      //To confirm no error on page reload
      await page.reload({waitUntil: 'networkidle0'});
      await page.waitForSelector(`#cb${componentName}`, {visible:true});
       await page.waitForSelector('#cbIncidentLog', {visible:true});
      let spanElement = await page.waitForSelector('#incident_0');
      expect(spanElement).toBeDefined();

      done();
    }, operationTimeOut);
})