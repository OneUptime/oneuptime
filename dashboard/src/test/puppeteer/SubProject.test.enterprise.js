const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let subProjectName = utils.generateRandomString();
const newSubProjectName = utils.generateRandomString();

describe('Sub-Project API', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            // user
            await init.registerEnterpriseUser(user, page);
        });

        await cluster.queue({ email, password });
        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should not create a sub-project with no name',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');

                await page.click('#projectSettings');

                await page.waitForSelector('#btn_Add_SubProjects');

                await page.click('#btn_Add_SubProjects');

                await page.click('#btnAddSubProjects');

                const spanSelector = await page.waitForSelector(
                    '#subProjectCreateErrorMessage',
                    { visible: true }
                );

                expect(
                    await (
                        await spanSelector.getProperty('textContent')
                    ).jsonValue()
                ).toEqual('Subproject name must be present.');
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should create a new sub-project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#btn_Add_SubProjects');
                await page.click('#btn_Add_SubProjects');
                await page.waitForSelector('#title');
                await page.type('#title', subProjectName);
                await page.click('#btnAddSubProjects');
                await page.waitForSelector('#title', { hidden: true });
                const subProjectSelector = await page.waitForSelector(
                    `#sub_project_name_${subProjectName}`,
                    { visible: true }
                );

                expect(
                    await (
                        await subProjectSelector.getProperty('textContent')
                    ).jsonValue()
                ).toEqual(subProjectName);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should rename a sub-project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                const editSubProjectName = utils.generateRandomString();
                await page.click(`#sub_project_edit_${subProjectName}`);
                const input = await page.$('#title');
                await input.click({ clickCount: 3 });
                await input.type(editSubProjectName);
                await page.click('#btnAddSubProjects');
                await page.waitForSelector('#title', { hidden: true });
                const subProjectSelector = await page.waitForSelector(
                    `#sub_project_name_${editSubProjectName}`,
                    { visible: true }
                );

                expect(
                    await (
                        await subProjectSelector.getProperty('textContent')
                    ).jsonValue()
                ).toEqual(editSubProjectName);
                subProjectName = editSubProjectName;
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should not create a sub-project with an existing sub-project name',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.click('#btn_Add_SubProjects');
                const input = await page.$('#title');
                await input.click({ clickCount: 3 });
                await input.type(subProjectName);
                await page.click('#btnAddSubProjects');
                const spanSelector = await page.waitForSelector(
                    '#subProjectCreateErrorMessage',
                    { visible: true }
                );

                expect(
                    await (
                        await spanSelector.getProperty('textContent')
                    ).jsonValue()
                ).toEqual('You already have a sub-project with same name.');
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a sub-project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector(
                    `#sub_project_delete_${subProjectName}`
                );
                await page.click(`#sub_project_delete_${subProjectName}`);
                await page.waitForSelector('#removeSubProject');
                await page.click('#removeSubProject');
                const subProjectSelector = await page.waitForSelector(
                    `#sub_project_name_${subProjectName}`,
                    { hidden: true }
                );

                expect(subProjectSelector).toEqual(null);
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should display confirmation message before resetting the sub project API Key',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#btn_Add_SubProjects');
                await page.click('#btn_Add_SubProjects');
                await page.waitForSelector('#title');
                await page.type('#title', newSubProjectName);
                await page.click('#btnAddSubProjects');
                await page.waitForSelector('button[title=apiKey]');
                await page.click('button[title=apiKey]');
                await page.waitForSelector('button[id=removeSubProject]');
                await page.click('button[id=removeSubProject]');
                let modalTitle = await page.$('span#modalTitle');
                modalTitle = await modalTitle.getProperty('innerText');
                modalTitle = await modalTitle.jsonValue();
                expect(modalTitle).toEqual('Confirm API Reset');
            });
        },
        operationTimeOut
    );

    test(
        'should reset the sub project API Key',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('button[title=apiKey]');
                await page.click('button[title=apiKey]');
                await page.waitForSelector('span#apiKey');
                await page.click('span#apiKey');
                let oldApiKey = await page.$('span#apiKey');
                oldApiKey = await oldApiKey.getProperty('innerText');
                oldApiKey = await oldApiKey.jsonValue();

                await page.waitForSelector('button[id=removeSubProject]');
                await page.click('button[id=removeSubProject]');
                await page.waitForSelector('button[id=confirmResetKey]');
                await page.click('button[id=confirmResetKey]');
                await page.waitForSelector('button[title=apiKey]');
                await page.click('button[title=apiKey]');
                await page.waitForSelector('button[id=sub_project_api_key_0]');
                await page.click('button[id=sub_project_api_key_0]');
                await page.waitForSelector('span#apiKey');
                await page.click('span#apiKey');
                let newApiKey = await page.$('span#apiKey');
                newApiKey = await newApiKey.getProperty('innerText');
                newApiKey = await newApiKey.jsonValue();
                expect(oldApiKey).not.toEqual(newApiKey);
            });
        },
        operationTimeOut
    );
});
