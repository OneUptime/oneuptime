const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let subProjectName = utils.generateRandomString();
const newSubProjectName = utils.generateRandomString();

describe('Sub-Project API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
            email,
            password,
        };

        // user
        await init.registerEnterpriseUser(user, page);
        await init.growthPlanUpgrade(page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not create a sub-project with no name',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await page.waitForSelector('#btn_Add_SubProjects');

            await init.pageClick(page, '#btn_Add_SubProjects');

            await init.pageClick(page, '#btnAddSubProjects');

            const spanSelector = await page.waitForSelector(
                '#subProjectCreateErrorMessage',
                { visible: true, timeout: init.timeout }
            );

            expect(
                await (
                    await spanSelector.getProperty('textContent')
                ).jsonValue()
            ).toEqual('Subproject name must be present.');
            done();
        },
        operationTimeOut
    );

    test(
        'should create a new sub-project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#btn_Add_SubProjects');
            await init.pageClick(page, '#btn_Add_SubProjects');
            await page.waitForSelector('#title');
            await init.pageType(page, '#title', subProjectName);
            await init.pageClick(page, '#btnAddSubProjects');
            await page.waitForSelector('#title', { hidden: true });
            const subProjectSelector = await page.waitForSelector(
                `#sub_project_name_${subProjectName}`,
                { visible: true, timeout: init.timeout }
            );

            expect(
                await (
                    await subProjectSelector.getProperty('textContent')
                ).jsonValue()
            ).toEqual(subProjectName);
            done();
        },
        operationTimeOut
    );

    test(
        'should rename a sub-project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            const editSubProjectName = utils.generateRandomString();
            await init.pageClick(page, `#sub_project_edit_${subProjectName}`);
            const input = await page.$('#title');
            await input.click({ clickCount: 3 });
            await input.type(editSubProjectName);
            await init.pageClick(page, '#btnAddSubProjects');
            await page.waitForSelector('#title', { hidden: true });
            const subProjectSelector = await page.waitForSelector(
                `#sub_project_name_${editSubProjectName}`,
                { visible: true, timeout: init.timeout }
            );

            expect(
                await (
                    await subProjectSelector.getProperty('textContent')
                ).jsonValue()
            ).toEqual(editSubProjectName);
            subProjectName = editSubProjectName;
            done();
        },
        operationTimeOut
    );

    test(
        'should not create a sub-project with an existing sub-project name',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await init.pageClick(page, '#btn_Add_SubProjects');
            const input = await page.$('#title');
            await input.click({ clickCount: 3 });
            await input.type(subProjectName);
            await init.pageClick(page, '#btnAddSubProjects');
            const spanSelector = await page.waitForSelector(
                '#subProjectCreateErrorMessage',
                { visible: true, timeout: init.timeout }
            );

            expect(
                await (
                    await spanSelector.getProperty('textContent')
                ).jsonValue()
            ).toEqual('You already have a sub-project with same name.');
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a sub-project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector(`#sub_project_delete_${subProjectName}`);
            await init.pageClick(page, `#sub_project_delete_${subProjectName}`);
            await page.waitForSelector('#removeSubProject');
            await init.pageClick(page, '#removeSubProject');
            const subProjectSelector = await page.waitForSelector(
                `#sub_project_name_${subProjectName}`,
                { hidden: true }
            );

            expect(subProjectSelector).toEqual(null);
            done();
        },
        operationTimeOut
    );

    test(
        'should display confirmation message before resetting the sub project API Key',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#btn_Add_SubProjects');
            await init.pageClick(page, '#btn_Add_SubProjects');
            await page.waitForSelector('#title');
            await init.pageType(page, '#title', newSubProjectName);
            await init.pageClick(page, '#btnAddSubProjects');
            await page.waitForSelector('button[title=apiKey]');
            await init.pageClick(page, 'button[title=apiKey]');
            await page.waitForSelector('button[id=removeSubProject]');
            await init.pageClick(page, 'button[id=removeSubProject]');
            let modalTitle = await page.$('span#modalTitle');
            modalTitle = await modalTitle.getProperty('innerText');
            modalTitle = await modalTitle.jsonValue();
            expect(modalTitle).toEqual('Confirm API Reset');
            done();
        },
        operationTimeOut
    );

    test(
        'should reset the sub project API Key',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('button[title=apiKey]');
            await init.pageClick(page, 'button[title=apiKey]');
            await page.waitForSelector('span#apiKey');
            await init.pageClick(page, 'span#apiKey');
            let oldApiKey = await page.$('span#apiKey');
            oldApiKey = await oldApiKey.getProperty('innerText');
            oldApiKey = await oldApiKey.jsonValue();

            await page.waitForSelector('button[id=removeSubProject]');
            await init.pageClick(page, 'button[id=removeSubProject]');
            await page.waitForSelector('button[id=confirmResetKey]');
            await init.pageClick(page, 'button[id=confirmResetKey]');
            await page.waitForSelector('button[title=apiKey]');
            await init.pageClick(page, 'button[title=apiKey]');
            await page.waitForSelector('button[id=sub_project_api_key_0]');
            await init.pageClick(page, 'button[id=sub_project_api_key_0]');
            await page.waitForSelector('span#apiKey');
            await init.pageClick(page, 'span#apiKey');
            let newApiKey = await page.$('span#apiKey');
            newApiKey = await newApiKey.getProperty('innerText');
            newApiKey = await newApiKey.jsonValue();
            expect(oldApiKey).not.toEqual(newApiKey);
            done();
        },
        operationTimeOut
    );
});
