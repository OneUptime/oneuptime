const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser1, browser2, page, newPage, userCredentials;

// parent user credentials
let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};
let projectName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();

// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = utils.generateRandomString();
const newUser = {
    email: newEmail,
    password: newPassword
};

let subProjectName = utils.generateRandomString();



describe('Monitor API With SubProjects', () => {
    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(200000);
        // browser for parent user
        browser1 = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser1.newPage();
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
    
        // browser sub-project user
        browser2 = await puppeteer.launch(utils.puppeteerLaunchConfig);
        newPage = await browser2.newPage();
        await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
    
        // intercept request and mock response for login
        await newPage.setRequestInterception(true);
        await newPage.on('request', async (request)=>{
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
        await newPage.on('response', async (response)=>{
            try{
                var res = await response.json();
                if(res && res.tokens){
                    userCredentials = res;
                }
            }catch(error){}
        });
    
        // parent user
        await init.registerUser(user, page);
        await init.loginUser(user, page);
    
        // rename default project
        await init.renameProject(projectName, page);
    
        // add sub-project
        await init.addSubProject(subProjectName, page);
    
        // new user (sub-project user)
        await init.registerUser(newUser, newPage);
        await init.loginUser(newUser, newPage);
    
        // add new user to sub-project
        await init.addUserToProject({email: newUser.email, role: 'Member', subProjectName}, page);
        
        // switch to invited project for new user
        await init.switchProject(projectName, newPage);
        
    });
    
    afterAll(async () => {
        await browser1.close();
        await browser2.close();
        
    });

    it('should not display new monitor form for user that is not `admin` in sub-project.', async () => {
        await newPage.waitForSelector('#monitors');
        await newPage.click('#monitors');
        const newMonitorForm = await newPage.$('#frmNewMonitor');
        expect(newMonitorForm).toEqual(null);
        
    }, operationTimeOut);

    it('should create a monitor in sub-project for valid `admin`', async () => {
        await page.waitForSelector('#monitors');
        await page.click('#monitors');
        await page.waitForSelector('#frmNewMonitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', subProjectMonitorName);
        await page.select('select[name=type_1000]','url');
        await init.selectByText('#subProjectId', subProjectName, page);
        await page.waitForSelector('#url');
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        let spanElement;
        spanElement = await page.$(`#monitor_title_${subProjectMonitorName}`);
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(subProjectMonitorName);
        
    }, operationTimeOut);

    it('should create a monitor in parent project for valid `admin`', async () => {
        let monitorName = utils.generateRandomString();
        await page.waitForSelector('#monitors');
        await page.click('#monitors');
        await page.waitForSelector('#frmNewMonitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await page.select('select[name=type_1000]','url');
        await page.waitForSelector('#url');
        await page.click('#url');
        await page.type('#url', 'https://fyipe.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        let spanElement;
        spanElement = await page.$(`#monitor_title_${monitorName}`);
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(monitorName);
        
    }, operationTimeOut);

    it(`should get only sub-project's monitors for valid sub-project user`, async () => {
        await newPage.reload({ waitUntil: 'networkidle2'});
        const projectBadgeSelector = await newPage.$(`#badge_${projectName} > div > span > span.Text-color--white`);
        await expect(projectBadgeSelector).toEqual(null);
        const subProjectBadgeSelector = await newPage.$(`#badge_${subProjectName} > div > span > span.Text-color--white`);
        let textContent = await subProjectBadgeSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual(subProjectName.toUpperCase());
        
    }, operationTimeOut);

    it('should get both project and sub-project monitors for valid parent project user.', async () => {
        
        const projectBadgeSelector = await page.$(`#badge_${projectName} > div > span > span.Text-color--white`);
        let textContent = await projectBadgeSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual('PROJECT');

        const subProjectBadgeSelector = await page.$(`#badge_${subProjectName} > div > span > span.Text-color--white`);
        textContent = await subProjectBadgeSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual(subProjectName.toUpperCase());

        
    }, operationTimeOut);
    
    it('should not display `Edit` and `Delete` button on monitor for user that is not `admin` in sub-project.', async () => {
        const editSelector = await newPage.$(`#edit_${subProjectMonitorName}`);
        await expect(editSelector).toEqual(null);

        const deleteSelector = await newPage.$(`#delete_${subProjectMonitorName}`);
        await expect(deleteSelector).toEqual(null);
        
    }, operationTimeOut);

    it('should delete sub-project monitor for user that is admin', async () => {
        await page.waitForSelector(`#delete_${subProjectMonitorName}`);
        await page.click(`#delete_${subProjectMonitorName}`);
        await page.waitForSelector('#deleteMonitor');
        await page.click('#deleteMonitor');
        await page.waitFor(5000);
        const subProjectSelector = await page.$(`#monitor_title_${subProjectMonitorName}`);
        await expect(subProjectSelector).toEqual(null);
        
    }, operationTimeOut);
});