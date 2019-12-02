const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const should = require('should');
const { Cluster } = require('puppeteer-cluster');

// user credentials
let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
let userCredentials, subProjectName;

describe('Sub-Project API', () => {
    const operationTimeOut = 50000;

    beforeAll(async (done) => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
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
                const signInResponse = userCredentials;

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
                        userCredentials = res;
                    }
                }catch(error){}
            });

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });

        await cluster.queue({ email, password });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async (done) => {
        done();
    });

    test('should not create a sub-project with no name', async (done) => {
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
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitForSelector('#projectSettings');

            await page.click('#projectSettings');

            await page.waitForSelector('#btn_Add_SubProjects');

            await page.click('#btn_Add_SubProjects');

            await page.click('#btnAddSubProjects');

            await page.waitFor(5000);

            const spanSelector = await page.$('#subProjectCreateErrorMessage');

            expect(await (await spanSelector.getProperty('textContent')).jsonValue()).toEqual('Subproject name must be present.')
        });

        cluster.queue({ email, password, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should create a new sub-project', async (done) => {
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
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);

            await page.waitForSelector('#projectSettings');

            await page.click('#projectSettings');

            await page.waitForSelector('#btn_Add_SubProjects');

            await page.click('#btn_Add_SubProjects');

            subProjectName = utils.generateRandomString();

            await page.waitForSelector('#title');

            await page.type('#title', subProjectName);

            await page.click('#btnAddSubProjects');

            await page.waitFor(5000);

            const subProjectSelector = await page.$('#sub_project_name_0');

            expect(await (await subProjectSelector.getProperty('textContent')).jsonValue()).toEqual(subProjectName)
        });

        cluster.queue({ email, password, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should rename a sub-project', async (done) => {
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
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);

            await page.waitForSelector('#projectSettings');

            await page.click('#projectSettings');

            const editSubProjectName = utils.generateRandomString();

            await page.click('#sub_project_edit_0');

            await page.waitForSelector('#title');

            await page.type('#title', editSubProjectName);

            await page.click('#btnAddSubProjects');

            await page.waitFor(5000);

            const subProjectSelector = await page.$('#sub_project_name_0');

            expect(await (await subProjectSelector.getProperty('textContent')).jsonValue()).toEqual(subProjectName + editSubProjectName)

            subProjectName = subProjectName + editSubProjectName
        });

        cluster.queue({ email, password, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should not create a sub-project with an existing sub-project name', async (done) => {
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
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);

            await page.waitForSelector('#projectSettings');

            await page.click('#projectSettings');

            await page.click('#btn_Add_SubProjects');

            await page.click('#title');

            await page.type('#title', subProjectName);

            await page.click('#btnAddSubProjects');

            await page.waitFor(5000);

            const spanSelector = await page.$('#subProjectCreateErrorMessage');

            expect(await (await spanSelector.getProperty('textContent')).jsonValue()).toEqual('You already have a sub-project with same name.')
        });

        cluster.queue({ email, password, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should delete a sub-project', async (done) => {
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
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#sub_project_delete_0');
            await page.click('#sub_project_delete_0');
            await page.click('#removeSubProject');

            await page.waitFor(5000);

            const subProjectSelector = await page.$('#sub_project_name_0');

            expect(subProjectSelector).toEqual(null)
        });

        cluster.queue({ email, password, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);
});
