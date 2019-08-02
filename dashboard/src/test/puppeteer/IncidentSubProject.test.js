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

beforeAll(async (done) => {
    jest.setTimeout(200000);
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
            const res = await response.json();
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
    
    done();
});

afterAll(async (done) => {
    await browser1.close();
    await browser2.close();
    done();
});

describe('Incident API With SubProjects', () => {
    const operationTimeOut = 30000;

    it('should create an incident in parent project for valid `admin`', async (done) => {
        await page.reload({ waitUntil: 'networkidle2'});
        await page.waitForSelector(`#create_incident_${projectMonitorName}`);
        await page.click(`#create_incident_${projectMonitorName}`);
        await page.waitForSelector('#createIncident');
        await page.click('#createIncident');
        await page.waitForSelector('#incident_span_0');
        const incidentTitleSelector = await page.$('#incident_span_0');
        let textContent = await incidentTitleSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent.toLowerCase()).toEqual(`${projectMonitorName}'s Incident Status`.toLowerCase());
        done();
    }, operationTimeOut);

    it('should create an incident in sub-project for sub-project `member`', async (done) => {
        await newPage.reload({ waitUntil: 'networkidle2'});
        await newPage.waitForSelector(`#create_incident_${subProjectMonitorName}`);
        await newPage.click(`#create_incident_${subProjectMonitorName}`);
        await newPage.waitForSelector('#createIncident');
        await newPage.click('#createIncident');
        await newPage.waitForSelector('#incident_span_0');
        const incidentTitleSelector = await newPage.$('#incident_span_0');
        let textContent = await incidentTitleSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent.toLowerCase()).toEqual(`${subProjectMonitorName}'s Incident Status`.toLowerCase());
        done();
    }, operationTimeOut);

    it('should acknowledge incident in sub-project for sub-project `member`', async (done) =>{
        await newPage.waitForSelector('#btnAcknowledge_0');
        await newPage.click('#btnAcknowledge_0');
        await newPage.waitForSelector('#AcknowledgeText_0');
        const acknowledgeTextSelector = await newPage.$('#AcknowledgeText_0');
        await expect(acknowledgeTextSelector).not.toBeNull();
        done();
    }, operationTimeOut);

    it('should resolve incident in sub-project for sub-project `member`', async (done) =>{
        await newPage.waitForSelector('#btnResolve_0');
        await newPage.click('#btnResolve_0');
        await newPage.waitForSelector('#ResolveText_0');
        const resolveTextSelector = await newPage.$('#ResolveText_0');
        await expect(resolveTextSelector).not.toBeNull();
        done();
    }, operationTimeOut);

    it('should update internal and investigation notes of incident in sub-project', async (done) =>{
        let investigationNote = utils.generateRandomString();
        let internalNote = utils.generateRandomString();
        await newPage.waitForSelector(`#incident_${subProjectMonitorName}_0`);
        await newPage.click(`#incident_${subProjectMonitorName}_0`);
        await newPage.waitForSelector('#txtInternalNote');
        await newPage.type('#txtInternalNote', internalNote);
        await newPage.click('#btnUpdateInternalNote');
        await newPage.waitFor(5000);
        await newPage.waitForSelector('#txtInvestigationNote');
        await newPage.type('#txtInvestigationNote', investigationNote);
        await newPage.click('#btnUpdateInvestigationNote');
        await newPage.waitFor(5000);
        const internalNoteSelector = await newPage.$('#txtInternalNote');
        let internalContent = await internalNoteSelector.getProperty('textContent');
        internalContent = await internalContent.jsonValue();
        await expect(internalContent).toEqual(internalNote);
        const investigationNoteSelector = await newPage.$('#txtInvestigationNote');
        let investigationContent = await investigationNoteSelector.getProperty('textContent');
        investigationContent = await investigationContent.jsonValue();
        await expect(investigationContent).toEqual(investigationNote);
        done();
    }, operationTimeOut);

    it('should get list of incidents and paginate for incidents in sub-project', async (done)=>{
        // add 5 more incident to sub-project monitor to test for pagination
        for(let i = 0; i < 10; i++){
            await init.addIncidentToProject(subProjectMonitorName, subProjectName, newPage);
        }
        let countIncidents = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countIncidents).toEqual(10);
        const nextSelector = await newPage.$('#btnNext');
        await nextSelector.click();
        await newPage.waitFor(5000);
        countIncidents = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countIncidents).toEqual(1);
        const prevSelector = await newPage.$('#btnPrev');
        await prevSelector.click();
        await newPage.waitFor(5000);
        countIncidents = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countIncidents).toEqual(10);
        done();
    }, 120000);
});     