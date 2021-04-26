const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const subProjectName = utils.generateRandomString();
const newProjectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();
const projectViewer = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const user = {
    email,
    password
};
const role = 'Viewer';

describe('Sub-Project API', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );                    
            // user
            await init.registerEnterpriseUser(user, page);
            await init.createUserFromAdminDashboard(projectViewer, page);       
        done();
    });

    afterAll(async done => {       
        await browser.close();
        done();
    });

    test(
        'should create a new sub-project',
        async done => {           
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                //Growth Plan is needed for a subproject
                await init.growthPlanUpgrade(page);                
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });                

                await init.renameProject(newProjectName, page);
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings',{visible:true});
                await page.click('#projectSettings');
               
                await page.waitForSelector('#btn_Add_SubProjects', {visible: true});
                await page.click('#btn_Add_SubProjects');
                await page.waitForSelector('#title', {visible: true});
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
            done();
        },
        operationTimeOut
    );

    test('should invite viewer to a subproject', async (done) => {       
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#teamMembers', {visible: true});
            await page.click('#teamMembers');
            let prevMemberCount = await page.$eval(
                `#count_${subProjectName}`,
                elem => elem.textContent
            );
            prevMemberCount = Number(prevMemberCount.split(' ')[0]);
            await page.waitForSelector(`button[id=btn_${subProjectName}]`, {visible: true});
            await page.click(`button[id=btn_${subProjectName}]`);
            await page.waitForSelector(`#frm_${subProjectName}`, {visible: true});
            await page.type('input[name=emails]', email);
            await page.click(`#${role}_${subProjectName}`);
            await page.waitForSelector(`#btn_modal_${subProjectName}`, {visible: true});
            await page.click(`#btn_modal_${subProjectName}`);
            await page.waitForSelector(`#btn_modal_${subProjectName}`, {
                hidden: true,
            });
            await page.waitForSelector(`#count_${subProjectName}`, {visible: true});
            let memberCount = await page.$eval(
                `#count_${subProjectName}`,
                elem => elem.textContent
            );
            memberCount = Number(memberCount.split(' ')[0]);
            expect(memberCount).toEqual(prevMemberCount + 1);
            done();        
    });

    test('should invite viewer to a project', async (done) => {     
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#teamMembers', {visible: true});
            await page.click('#teamMembers');
            await page.waitForSelector(`#count_${newProjectName}`, {visible: true});
            let prevMemberCount = await page.$eval(
                `#count_${newProjectName}`,
                elem => elem.textContent
            );
            prevMemberCount = Number(prevMemberCount.split(' ')[0]);

            await page.waitForSelector(`button[id=btn_${newProjectName}]`, {visible: true});
            await page.click(`button[id=btn_${newProjectName}]`);
            await page.waitForSelector(`#frm_${newProjectName}`, {visible: true});
            await page.type('input[name=emails]', projectViewer.email);
            await page.click(`#${role}_${newProjectName}`);
            await page.waitForSelector(`#btn_modal_${newProjectName}`, {visible: true});
            await page.click(`#btn_modal_${newProjectName}`);
            const elem = await page.$('button[id=btnConfirmInvite]');
            elem.click();
            await page.waitForSelector(`#btn_modal_${newProjectName}`, {
                hidden: true,
            });
            await page.waitForSelector(`#count_${newProjectName}`, {visible: true});
            let memberCount = await page.$eval(
                `#count_${newProjectName}`,
                elem => elem.textContent
            );
            memberCount = Number(memberCount.split(' ')[0]);
            expect(memberCount).toEqual(prevMemberCount + 1);
            done();      
    });

    test('should create a status page', async (done) => {     
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#statusPages', {visible: true});
            await page.click('#statusPages');
            await page.waitForSelector(`#status_page_count_${newProjectName}`, {visible: true});
            let oldStatusPageCounter = await page.$eval(
                `#status_page_count_${newProjectName}`,
                elem => elem.textContent
            );
            oldStatusPageCounter = Number(oldStatusPageCounter.split(' ')[0]);
            await init.addStatusPageToProject(
                statusPageName,
                newProjectName,
                page
            );
            await page.waitForSelector(`#status_page_count_${newProjectName}`, {visible: true});
            let statusPageCounter = await page.$eval(
                `#status_page_count_${newProjectName}`,
                elem => elem.textContent
            );
            statusPageCounter = Number(statusPageCounter.split(' ')[0]);
            expect(statusPageCounter).toEqual(oldStatusPageCounter + 1);
            done();       
    });

    test(
        'should display subproject status pages to a subproject viewer',
        async (done) => {            
                // Login as viewer
                await init.logout(page);
                await init.loginUser({ email, password }, page);
                await page.waitForSelector('#AccountSwitcherId', {visible: true});
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#accountSwitcher', {visible: true});
                const element = await page.$(
                    `#accountSwitcher > div[title=${newProjectName}]`
                );
                element.click();            
                await page.waitForSelector('#statusPageTable_0', {visible: true});
                const projectStatusPages = await page.$('#statusPageTable');
                expect(projectStatusPages).toEqual(null);

                const subProjectStatusPages = await page.$(
                    '#statusPageTable_0'
                );
                expect(subProjectStatusPages).not.toEqual(null);
                done();            
        },
        operationTimeOut
    );

    test(
        'should display project and subproject status pages to project viewers',
        async (done) => {          
                await init.logout(page);
                await init.loginUser(projectViewer, page);
                await page.waitForSelector('#AccountSwitcherId', {visible: true});
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#accountSwitcher', {visible: true});
                const element = await page.$(
                    `#accountSwitcher > div[title=${newProjectName}]`
                );
                element.click();                
                await page.waitForSelector('#statusPageTable_0', {visible: true});
                const projectStatusPages = await page.$('#statusPageTable');
                expect(projectStatusPages).not.toEqual(null);

                const subProjectStatusPages = await page.$(
                    '#statusPageTable_0'
                );
                expect(subProjectStatusPages).not.toEqual(null);
                done();           
        },
        operationTimeOut
    );

    test('should redirect viewer to external status page', async (done) => {       
            await init.logout(page);
            await init.loginUser(projectViewer, page);
            await page.waitForSelector('#AccountSwitcherId', {visible: true});
            await page.click('#AccountSwitcherId');
            await page.waitForSelector('#accountSwitcher', {visible: true});
            const element = await page.$(
                `#accountSwitcher > div[title=${newProjectName}]`
            );
            element.click();           
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true }
            );
            rowItem.click();
            const statusPage = await page.$(`#cb${statusPageName}`);
            expect(statusPage).toEqual(null);
            done();       
    });
});
