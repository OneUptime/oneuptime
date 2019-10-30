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

// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = utils.generateRandomString();
const newUser = {
    email: newEmail,
    password: newPassword
};

let projectName = utils.generateRandomString();
let projectMonitorName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();
let subProjectName = utils.generateRandomString();

describe('Incident API With SubProjects', () => {
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
                const res = await response.json();
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
                const res = await response.json();
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
    
        // add new monitor to parent project and sub-project
        await init.addMonitorToProject(projectMonitorName, projectName, page);
        await init.addMonitorToProject(subProjectMonitorName, subProjectName, page);
        
    });
    
    afterAll(async () => {
        await browser1.close();
        await browser2.close();
    });
});     