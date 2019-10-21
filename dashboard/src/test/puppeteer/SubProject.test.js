const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const should = require('should');

let browser, page, subProjectName, userCredentials;

let password = utils.generateRandomString();

let email = utils.generateRandomBusinessEmail();

const user = {
    email,
    password
};



describe('Sub-Project API', () => {

    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(150000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');

        // intercept request and mock response for login
        await page.setRequestInterception(true);
        await page.on('request', async (request) => {
            if ((await request.url()).match(/user\/login/)) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            } else {
                request.continue();
            }
        });
        await page.on('response', async (response) => {
            try {
                var res = await response.json();
                if (res && res.tokens) {
                    userCredentials = res;
                }
            } catch (error) { }
        });

        await init.registerUser(user, page);
        await init.loginUser(user, page);

    });

    afterAll(async () => {
        await browser.close();

    });

    it('should not create a sub-project with no name', async () => {

        await page.waitForSelector('#projectSettings');

        await page.click('#projectSettings');

        await page.waitForSelector('#btnAddSubProjects');

        await page.click('#btnAddSubProjects');

        await page.click('#btnSaveSubproject');

        await page.waitFor(5000);

        const spanSelector = await page.$('#frmSubProjects > div > div > div > div.Box-root > span');
        expect(await (await spanSelector.getProperty('innerText')).jsonValue()).toEqual('Subproject name must be present.')


    }, operationTimeOut);

    it('should create a new sub-project', async () => {

        subProjectName = utils.generateRandomString();

        await page.waitForSelector('#sub_project_name_0');

        await page.type('#sub_project_name_0', subProjectName);

        await page.click('#btnSaveSubproject');

        await page.waitFor(5000);

        const subProjectSelector = await page.$('#sub_project_name_0');
        expect(await (await subProjectSelector.getProperty('value')).jsonValue()).toEqual(subProjectName)


    }, operationTimeOut);

    it('should rename a sub-project', async () => {
        const editSubProjectName = utils.generateRandomString();

        await page.click('#sub_project_name_0');

        await page.type('#sub_project_name_0', editSubProjectName);

        await page.click('#btnSaveSubproject');

        await page.waitFor(5000);

        const subProjectSelector = await page.$('#sub_project_name_0');
        expect(await (await subProjectSelector.getProperty('value')).jsonValue()).toEqual(subProjectName + editSubProjectName)

        subProjectName = subProjectName + editSubProjectName

    }, operationTimeOut);

    it('should not create a sub-project with an existing sub-project name', async () => {

        await page.click('#btnAddSubProjects');

        await page.click('#sub_project_name_1');

        await page.type('#sub_project_name_1', subProjectName);

        await page.click('#btnSaveSubproject');

        await page.waitFor(5000);

        const spanSelector = await page.$('#frmSubProjects > div > div > div > div.Box-root > span');
        expect(await (await spanSelector.getProperty('innerText')).jsonValue()).toEqual('You already have a sub-project with same name.')


    }, operationTimeOut);

    it('should delete a sub-project', async () => {
        await page.click('#btnRemoveSubproject1');
        await page.click('#btnRemoveSubproject0');
        await page.click('#removeSubProject');
        await page.click('#btnSaveSubproject');

        await page.waitFor(5000);

        const subProjectSelector = await page.$('#sub_project_name_0');
        expect(subProjectSelector).toEqual(null)


    }, operationTimeOut);
});
