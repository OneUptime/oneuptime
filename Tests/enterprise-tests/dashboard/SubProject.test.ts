import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: $TSFixMe = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
let subProjectName = utils.generateRandomString();
const newSubProjectName: $TSFixMe = utils.generateRandomString();

describe('Sub-Project API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user: $TSFixMe = {
            email,
            password,
        };

        // user
        await init.registerEnterpriseUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not create a sub-project with no name',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#btn_Add_SubProjects');

            await init.pageClick(page, '#btn_Add_SubProjects');

            await init.pageClick(page, '#btnAddSubProjects');

            const spanSelector: $TSFixMe = await init.pageWaitForSelector(
                page,
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#btn_Add_SubProjects');

            await init.pageClick(page, '#btn_Add_SubProjects');

            await init.pageWaitForSelector(page, '#title');

            await init.pageType(page, '#title', subProjectName);

            await init.pageClick(page, '#btnAddSubProjects');
            await init.pageWaitForSelector(page, '#title', { hidden: true });
            const subProjectSelector: $TSFixMe = await init.pageWaitForSelector(
                page,
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');
            const editSubProjectName: $TSFixMe = utils.generateRandomString();

            await init.pageClick(page, `#sub_project_edit_${subProjectName}`);

            const input: $TSFixMe = await init.page$(page, '#title');
            await input.click({ clickCount: 3 });
            await input.type(editSubProjectName);

            await init.pageClick(page, '#btnAddSubProjects');
            await init.pageWaitForSelector(page, '#title', { hidden: true });
            const subProjectSelector: $TSFixMe = await init.pageWaitForSelector(
                page,
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageClick(page, '#btn_Add_SubProjects');

            const input: $TSFixMe = await init.page$(page, '#title');
            await input.click({ clickCount: 3 });
            await input.type(subProjectName);

            await init.pageClick(page, '#btnAddSubProjects');
            const spanSelector: $TSFixMe = await init.pageWaitForSelector(
                page,
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(
                page,
                `#sub_project_delete_${subProjectName}`
            );

            await init.pageClick(page, `#sub_project_delete_${subProjectName}`);

            await init.pageWaitForSelector(page, '#removeSubProject');

            await init.pageClick(page, '#removeSubProject');
            const subProjectSelector: $TSFixMe = await init.pageWaitForSelector(
                page,
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
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#btn_Add_SubProjects');

            await init.pageClick(page, '#btn_Add_SubProjects');

            await init.pageWaitForSelector(page, '#title');

            await init.pageType(page, '#title', newSubProjectName);

            await init.pageClick(page, '#btnAddSubProjects');

            await init.pageWaitForSelector(page, 'button[title=apiKey]');

            await init.pageClick(page, 'button[title=apiKey]');

            await init.pageWaitForSelector(page, 'button[id=removeSubProject]');

            await init.pageClick(page, 'button[id=removeSubProject]');

            let modalTitle = await init.page$(page, 'span#modalTitle');
            modalTitle = await modalTitle.getProperty('innerText');
            modalTitle = await modalTitle.jsonValue();
            expect(modalTitle).toEqual('Confirm API Reset');
            done();
        },
        operationTimeOut
    );

    test(
        'should reset the sub project API Key',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, 'button[title=apiKey]');

            await init.pageClick(page, 'button[title=apiKey]');

            await init.pageWaitForSelector(page, 'span#apiKey');

            await init.pageClick(page, 'span#apiKey');

            let oldApiKey = await init.page$(page, 'span#apiKey');
            oldApiKey = await oldApiKey.getProperty('innerText');
            oldApiKey = await oldApiKey.jsonValue();

            await init.pageWaitForSelector(page, 'button[id=removeSubProject]');

            await init.pageClick(page, 'button[id=removeSubProject]');

            await init.pageWaitForSelector(page, 'button[id=confirmResetKey]');

            await init.pageClick(page, 'button[id=confirmResetKey]');

            await init.pageWaitForSelector(page, 'button[title=apiKey]');

            await init.pageClick(page, 'button[title=apiKey]');

            await init.pageWaitForSelector(
                page,
                'button[id=sub_project_api_key_0]'
            );

            await init.pageClick(page, 'button[id=sub_project_api_key_0]');

            await init.pageWaitForSelector(page, 'span#apiKey');

            await init.pageClick(page, 'span#apiKey');

            let newApiKey = await init.page$(page, 'span#apiKey');
            newApiKey = await newApiKey.getProperty('innerText');
            newApiKey = await newApiKey.jsonValue();
            expect(oldApiKey).not.toEqual(newApiKey);
            done();
        },
        operationTimeOut
    );
});
