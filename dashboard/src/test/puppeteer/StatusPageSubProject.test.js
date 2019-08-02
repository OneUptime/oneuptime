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
let subProjectMonitorName = utils.generateRandomString();
let subProjectName = utils.generateRandomString();

beforeAll(async (done) => {
    jest.setTimeout(150000);
    // browser for parent user
    browser1 = await puppeteer.launch();
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
    browser2 = await puppeteer.launch();
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

    // add new monitor to parent project and sub-project
    await init.addMonitorToProject(subProjectMonitorName, subProjectName, page);
    
    done();
});

afterAll(async (done) => {
    await browser1.close();
    await browser2.close();
    done();
});

describe('StatusPage API With SubProjects', () => {
    const operationTimeOut = 20000;

    it('should not display create status page button for subproject `member` role.', async (done)=>{
        await newPage.waitForSelector(`#statusPages > a`);
        await newPage.click(`#statusPages > a`);
        const createButton = await newPage.$(`#btnCreateStatusPage_${subProjectName}`);
        expect(createButton).toBe(null);
        done();
    });

    it('should create a status page in sub-project for sub-project `admin`', async (done) => {
        const statuspageName = utils.generateRandomString();
        await page.waitForSelector(`#statusPages > a`);
        await page.click(`#statusPages > a`);
        await page.waitForSelector(`#btnCreateStatusPage_${subProjectName}`);
        await page.click(`#btnCreateStatusPage_${subProjectName}`);
        await page.waitForSelector('#btnCreateStatusPage');
        await page.type('#title', statuspageName);
        await page.click('#btnCreateStatusPage');
        await page.waitFor(5000);
        await page.waitForSelector(`#status_page_count_${subProjectName}`);
        const statusPageCountSelector = await page.$(`#status_page_count_${subProjectName}`);
        let textContent = await statusPageCountSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual('1 status page');
        done();
    }, operationTimeOut);

    it('should get list of status pages in sub-projects and paginate status pages in sub-project', async (done)=>{
        // add 10 more statuspages to sub-project to test for pagination
        for(let i = 0; i < 10; i++){
            const statuspageName = utils.generateRandomString();
            await init.addStatusPageToProject(statuspageName, subProjectName, page);
        }
        await newPage.reload({ waitUntil: 'networkidle2'});
        await newPage.waitForSelector(`#statusPages > a`);
        await newPage.click(`#statusPages > a`);
        await newPage.waitFor(5000);
        let countStatusPages = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countStatusPages).toEqual(10);
        const nextSelector = await newPage.$('button[data-db-analytics-name="list_view.pagination.next"]');
        await nextSelector.click();
        await newPage.waitFor(5000);
        countStatusPages = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countStatusPages).toEqual(1);
        const prevSelector = await newPage.$('button[data-db-analytics-name="list_view.pagination.previous"]');
        await prevSelector.click();
        await newPage.waitFor(5000);
        countStatusPages = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countStatusPages).toEqual(10);
        done();
    }, 120000);

    it('should update sub-project status page settings', async (done)=>{
        await page.waitForSelector('.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')
        await page.click('.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink');
        await page.waitFor(5000);
        await page.waitForSelector(`span[title="${subProjectMonitorName}"]`);
        await page.click(`span[title="${subProjectMonitorName}"]`);
        await page.click(`#btnAddStatusPageMonitors`);
        await page.click('#domain');
        await page.type('#domain', 'https://fyipe.com');
        await page.click('#btnAddDomain');
        await page.click('textarea[name=description]');
        await page.type('textarea[name=description]', 'Statuspage Description');
        await page.waitForSelector('#btnAddLink');
        await page.click('#btnAddLink');
        await page.waitForSelector('#name_0');
        await page.click('#name_0');
        await page.type('#name_0', 'Home');
        await page.click('#url_0');
        await page.type('#url_0', 'https://fyipe.com');
        await page.click('#btnSaveLinks');
        await page.waitFor(5000);
        done();
    }, operationTimeOut);

    it('should delete sub-project status page', async (done)=>{
        await page.waitForSelector('#delete');
        await page.click('#delete');
        await page.waitForSelector('#confirmDelete');
        await page.click('#confirmDelete');
        await page.waitFor(5000);
        done();
    }, operationTimeOut);
});     