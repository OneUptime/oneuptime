const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password
};
describe('Enterprise Monitor SubProject API', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );           
        // user
            await init.registerEnterpriseUser(user, page);        
       
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should create a monitor in sub-project for valid `admin`',
        async done => {
         
            const subProjectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            const subProjectMonitorName = utils.generateRandomString();
           
                await init.adminLogout(page);
                await init.loginUser(user, page);
                await init.growthPlanUpgrade(page);
                await page.reload({
                    waitUntil : 'networkidle0'
                });
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                // add sub-project
                await init.addSubProject(subProjectName, page);

                // Create Component first
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                // switch to invited project for new user
                await page.waitForSelector('#monitors', {visible:true});
                await page.waitForSelector('#form-new-monitor', {visible:true});
                await page.click('input[id=name]');
                await page.type('input[id=name]', subProjectMonitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', {visible:true});
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');                

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${subProjectMonitorName}`, {visible:true}
                );

                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).toBe(subProjectMonitorName);
            
            done();
        },
        operationTimeOut
    );
});
