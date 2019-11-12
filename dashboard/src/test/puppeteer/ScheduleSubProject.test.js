const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
let projectName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = utils.generateRandomString();
let subProjectName = utils.generateRandomString();
let userCredentials = [];


describe('Schedule API With SubProjects', () => {
    const operationTimeOut = 50000;

    beforeAll(async (done) => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            maxConcurrency: 2,
            puppeteer,
            timeout: 120000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        // Register user 
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            
            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => {
                const signInResponse = userCredentials.find(userCredentials => userCredentials.email === user.email);

                if((await request.url()).match(/user\/login/)){
                    request.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(signInResponse)
                    });
                }else{
                    request.continue();
                }
            });
            await page.on('response', async (response)=>{
                try{
                    const res = await response.json();
                    if(res && res.tokens){
                        userCredentials.push(res);
                    }
                }catch(error){}
            });

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        
            if(data.isParentUser){
                // rename default project
                await init.renameProject(data.projectName, page);
                // add sub-project
                await init.addSubProject(data.subProjectName, page);
                // add new user to sub-project
                await init.addUserToProject({ email: data.newEmail, role: 'Member', subProjectName: data.subProjectName }, page);
                // add new monitor to sub-project
                await init.addMonitorToProject(data.subProjectMonitorName, data.subProjectName, page);
            }
        });

        await cluster.queue({ projectName, subProjectName, email, password, newEmail, subProjectMonitorName, isParentUser: true });
        await cluster.queue({ projectName, subProjectName, email: newEmail, password: newPassword, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();
    });
    
    afterAll(async (done) => {
        done();
    });

    test('should not display create schedule button for subproject `member` role.', async (done) =>{
        expect.assertions(1);
        
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            const signInResponse = data.userCredentials.find(userDetails => userDetails.email === user.email);

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            // switch to invited project for new user
            await init.switchProject(data.projectName, page);

            await page.waitForSelector(`#callSchedules > a`);
            await page.click(`#callSchedules > a`);

            const createButton = await page.$(`#btnCreateSchedule_${data.subProjectName}`);
            
            expect(createButton).toBe(null);
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName, subProjectName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should create a schedule in sub-project for sub-project `admin`', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });
        const scheduleName = utils.generateRandomString();

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            const signInResponse = data.userCredentials.find(userDetails => userDetails.email === user.email);

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await init.addScheduleToProject(data.scheduleName, data.subProjectName, page);
            await page.waitForSelector(`#schedule_count_${data.subProjectName}`);
            
            const scheduleCountSelector = await page.$(`#schedule_count_${data.subProjectName}`);
            let textContent = await scheduleCountSelector.getProperty('innerText');
            
            textContent = await textContent.jsonValue();
            expect(textContent).toEqual('1 schedule');
        });

        cluster.queue({ email, password, subProjectName, scheduleName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should get list schedules in sub-projects and paginate schedules in sub-project', async (done)=>{
        expect.assertions(3);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 150000,
            maxConcurrency: 2
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            const signInResponse = data.userCredentials.find(userDetails => userDetails.email === user.email);

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));
            await init.loginUser(user, page);
            if(data.isParentUser){
                // add 10 more schedules to sub-project to test for pagination
                for (let i = 0; i < 10; i++) {
                    const scheduleName = utils.generateRandomString();

                    await init.addScheduleToProject(scheduleName, data.subProjectName, page);
                }
            }else{
                await cluster.waitForOne();
                // switch to invited project for new user
                await init.switchProject(data.projectName, page);
                await page.waitForSelector(`#callSchedules > a`);
                await page.click(`#callSchedules > a`);
                await page.waitFor(3000);
    
                let scheduleRows = await page.$$('tr.scheduleListItem');
                let countSchedules = scheduleRows.length;
    
                expect(countSchedules).toEqual(10);
    
                const nextSelector = await page.$('#btnNext');
                
                await nextSelector.click();
                await page.waitFor(5000);
                scheduleRows = await page.$$('tr.scheduleListItem');
                countSchedules = scheduleRows.length;
                expect(countSchedules).toEqual(1);
                
                const prevSelector = await page.$('#btnPrev');
                
                await prevSelector.click();
                await page.waitFor(5000);
                scheduleRows = await page.$$('tr.scheduleListItem');
                countSchedules = scheduleRows.length;
                expect(countSchedules).toEqual(10);
            }
        });

        cluster.queue({ email, password, subProjectName, userCredentials, isParentUser: true });
        cluster.queue({ email: newEmail, password: newPassword, projectName, userCredentials, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();

    }, 200000);

    test('should add monitor to sub-project schedule', async (done) =>{
        expect.assertions(1);
        
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 50000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            const signInResponse = data.userCredentials.find(userDetails => userDetails.email === user.email);

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitForSelector(`#callSchedules > a`);
            await page.click(`#callSchedules > a`);
            await page.waitFor(3000);
            await page.waitForSelector('tr.scheduleListItem')
            await page.click('tr.scheduleListItem');
            await page.waitFor(5000);
            await page.waitForSelector(`span[title="${data.subProjectMonitorName}"]`);
            await page.click(`span[title="${data.subProjectMonitorName}"]`);
            await page.waitForSelector('#btnSaveMonitors');
            await page.click('#btnSaveMonitors');
            await page.waitFor(5000);
        });

        cluster.queue({ email, password, projectName, subProjectMonitorName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should delete sub-project schedule', async (done) =>{
        expect.assertions(1);
        
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            const signInResponse = data.userCredentials.find(userDetails => userDetails.email === user.email);

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitForSelector(`#callSchedules > a`);
            await page.click(`#callSchedules > a`);
            await page.waitFor(3000);
            await page.waitForSelector('tr.scheduleListItem')
            await page.click('tr.scheduleListItem');
            await page.waitFor(5000);
            await page.waitForSelector('#delete');
            await page.click('#delete');
            await page.waitForSelector('#confirmDelete');
            await page.click('#confirmDelete');
            await page.waitFor(5000);
        });

        cluster.queue({ email, password, projectName, subProjectMonitorName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);
});     