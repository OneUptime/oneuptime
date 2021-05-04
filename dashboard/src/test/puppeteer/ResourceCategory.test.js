const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const secondEmail = utils.generateRandomBusinessEmail();
const teamEmail = utils.generateRandomBusinessEmail();
const newProjectName = 'Test';
const resourceCategory = 'stat';
const user = {
    email,
    password,
};

describe('Resource Category', () => {
    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(200000);        

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user              
            await init.registerUser(user, page);
            // Create Component first
            await init.addComponent(componentName, page);        
    });

    afterAll(async (done) => {        
        await browser.close();
        done();
    });

    test(
        'should create a new resource category',
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('#more', {visible: true});
                await page.click('#more');

                await page.waitForSelector('li#resources a', {visible: true});
                await page.click('li#resources a');
                await page.waitForSelector('#createResourceCategoryButton', {visible: true});
                await page.click('#createResourceCategoryButton');
                await page.type(
                    '#resourceCategoryName',
                    utils.resourceCategoryName
                );
                await page.click('#addResourceCategoryButton');

                const createdResourceCategorySelector =
                    '#resourceCategoryList #resource-category-name:nth-child(2)';

                await page.waitForSelector(createdResourceCategorySelector, {visible: true});

                const createdResourceCategoryName = await page.$eval(
                    createdResourceCategorySelector,
                    el => el.textContent
                );

                expect(createdResourceCategoryName).toEqual(
                    utils.resourceCategoryName
                );    
                done();
        },
        operationTimeOut
    );

    test(
        'should show created resource category in new monitor dropdown',
        async (done) => {            
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#form-new-monitor', {visible: true});

                let resourceCategoryCheck = false;

                await init.selectByText(
                    '#resourceCategory',
                    utils.resourceCategoryName,
                    page
                );

                const noOption = await page.$('div.css-1gl4k7y');

                if (!noOption) {
                    resourceCategoryCheck = true;
                }
                expect(resourceCategoryCheck).toEqual(true);
            done();
        },
        operationTimeOut
    );

    test(
        'should create a new monitor by selecting resource category from dropdown',
        async (done) => {            
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor', {visible: true});
                await page.click('input[id=name]');
                await page.type('input[id=name]', utils.monitorName);
                await init.selectByText(
                    '#resourceCategory',
                    utils.resourceCategoryName,
                    page
                );
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await Promise.all([
                    page.click('button[type=submit]'),
                    page.waitForNavigation(),
                ]);

                const createdMonitorSelector = `#monitor-title-${utils.monitorName}`;
                await page.waitForSelector(createdMonitorSelector, {
                    visible: true,
                    timeout: operationTimeOut,
                });
                const createdMonitorName = await page.$eval(
                    createdMonitorSelector,
                    el => el.textContent
                );

                expect(createdMonitorName).toEqual(utils.monitorName);
            done();
        },
        operationTimeOut
    );

    test(
        'should delete the created resource category',
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('#more', {visible: true});
                await page.click('#more');

                await page.waitForSelector('li#resources a', {visible: true});
                await page.click('li#resources a');

                const deleteButtonSelector = `button#delete_${utils.resourceCategoryName}`;

                await page.waitForSelector(deleteButtonSelector, {visible: true});
                await page.click(deleteButtonSelector);
                await page.waitForSelector('#deleteResourceCategory', {visible: true});
                await page.click('#deleteResourceCategory');
                await page.waitForSelector('#resourceCategoryCount', {visible: true});

                const resourceCategoryCounterSelector =
                    '#resourceCategoryCount';
                const resourceCategoryCount = await page.$eval(
                    resourceCategoryCounterSelector,
                    el => el.textContent
                );

                expect(resourceCategoryCount).toEqual('0 Resource Category');
            done();
        },
        operationTimeOut
    );
});

describe('Member Restriction', () => {
    const operationTimeOut = 50000;


    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
                // user
                await init.registerUser({email: secondEmail, password}, page);
                await init.renameProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL);
                await init.addUserToProject(
                    {
                        email: teamEmail,
                        role: 'Member',
                        subProjectName: newProjectName,
                    },
                    page
                );
                await init.addResourceCategory(resourceCategory, page);
                await init.logout(page);                
        done();
    });

    afterAll(async done => {        
        await browser.close();
        done();
    });

    test(
        'should show unauthorised modal when trying to add a resource category for a member who is not the admin or owner of the project',
        async done => {            
                // A Subproject user has to register his/her mail before login in.
                await init.registerAndLoggingTeamMember(
                    { email: teamEmail, password },
                    page
                );
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more', {visible: true});
                await page.click('#more');

                await page.waitForSelector('#resources', {visible: true});
                await page.click('#resources');
                await page.waitForSelector('#createResourceCategoryButton', {
                    visible: true,
                });
                await page.click('#createResourceCategoryButton');
                const modal = await page.waitForSelector('#unauthorisedModal', {visible: true});
                expect(modal).toBeDefined();            
            done();
        },
        operationTimeOut
    );

    test(
        'should show unauthorised modal when trying to edit a resource category for a member who is not the admin or owner of the project',
        async done => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more', {visible: true});
                await page.click('#more');

                await page.waitForSelector('#resources', {visible: true});
                await page.click('#resources');
                const editBtn = `#edit_${resourceCategory}`;
                await page.waitForSelector(editBtn, {
                    visible: true,
                });
                await page.click(editBtn);
                const modal = await page.waitForSelector('#unauthorisedModal', {visible: true});
                expect(modal).toBeDefined();            
            done();
        },
        operationTimeOut
    );

    test(
        'should show unauthorised modal when trying to delete a resource category for a member who is not the admin or owner of the project',
        async done => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more', {visible: true});
                await page.click('#more');

                await page.waitForSelector('#resources', {visible: true});
                await page.click('#resources');
                const deleteBtn = `#delete_${resourceCategory}`;
                await page.waitForSelector(deleteBtn, {
                    visible: true,
                });
                await page.click(deleteBtn);
                const modal = await page.waitForSelector('#unauthorisedModal', {visible: true});
                expect(modal).toBeDefined();            
            done();
        },
        operationTimeOut
    );
});
