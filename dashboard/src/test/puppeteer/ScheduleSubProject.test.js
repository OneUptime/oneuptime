const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

let browser, page;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

const user = {
    email,
    password,
};

describe('Schedule API With SubProjects', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user 
        await init.registerUser(user, page); // This auto log in the user.
        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page);

        // add sub-project
        await init.addSubProject(subProjectName, page);
        // Create Component
        await init.addComponent(componentName, page, subProjectName);
        await page.goto(utils.DASHBOARD_URL);
        // add new user to sub-project
        await init.addUserToProject(
            {
                email: newEmail,
                role: 'Member',
                subProjectName,
            },
            page
        );
        // Navigate to details page of component created 
        await init.addNewMonitorToComponent(page, componentName, subProjectMonitorName);
        await init.logout(page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not display create schedule button for subproject `member` role.',
        async done => {
            await init.registerAndLoggingTeamMember({ email: newEmail, password: newPassword }, page); // This is for subproject
            // switch to invited project for new user
            // await init.switchProject(data.projectName, page);

            await page.waitForSelector('#onCallDuty');
            await page.click('#onCallDuty');

            const createButton = await page.$(
                `#btnCreateSchedule_${subProjectName}`
            );

            expect(createButton).toBe(null);
            await init.logout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should create a schedule in sub-project for sub-project `admin`',
        async done => {            
            const scheduleName = utils.generateRandomString();
            console.log("schedulename: ", scheduleName)
            await init.loginUser(user, page);
            await init.addScheduleToProject(
                scheduleName,
                subProjectName,
                page
            );
            await page.waitForSelector(
                `#schedule_count_${subProjectName}`, { visible: true }
            );
            await page.reload({ waitUntil: 'networkidle0' });

            const scheduleCountSelector = await page.waitForSelector(
                `#schedule_count_${subProjectName}`, { visible: true }
            );
            let textContent = await scheduleCountSelector.getProperty(
                'innerText'
            );

            textContent = await textContent.jsonValue();            
            expect(textContent).toMatch('Page 1 of 1 (1 duty)');
            done();
        },
        operationTimeOut
    );

    test('should get list schedules in sub-projects and paginate schedules in sub-project', async done => {
        await page.goto(utils.DASHBOARD_URL);
        // add 10 more schedules to sub-project to test for pagination
        for (let i = 0; i < 10; i++) {
            const scheduleName = utils.generateRandomString();
            await init.addScheduleToProject(
                scheduleName,
                subProjectName,
                page
            );
        }
        
        await page.waitForSelector('#onCallDuty');
        await page.click('#onCallDuty');
        await page.waitForSelector('tr.scheduleListItem');

        let scheduleRows = await page.$$('tr.scheduleListItem');
        let countSchedules = scheduleRows.length;

        expect(countSchedules).toEqual(10);

        //const nextSelector = 
        await page.waitForSelector(`#btnNext-${subProjectName}`, {visible:true});

       // await nextSelector.click();
        await page.click(`#btnNext-${subProjectName}`);
        await page.waitForTimeout(5000);
        scheduleRows = await page.$$('tr.scheduleListItem');
        countSchedules = scheduleRows.length;
        expect(countSchedules).toEqual(1);

       // const prevSelector = 
        await page.waitForSelector(`#btnPrev-${subProjectName}`, {visible:true});
        await page.click(`#btnPrev-${subProjectName}`);
        //await prevSelector.click();
        await page.waitForTimeout(5000);
        scheduleRows = await page.$$('tr.scheduleListItem');
        countSchedules = scheduleRows.length;
        expect(countSchedules).toEqual(10);

        done();
    }, 200000);

    test(
        'should add monitor to sub-project schedule',
        async done => {            
                    await page.goto(utils.DASHBOARD_URL);                    
                    await page.waitForSelector('#onCallDuty');
                    await page.click('#onCallDuty');
                    await page.waitForSelector('tr.scheduleListItem');
                    await page.click('tr.scheduleListItem');
                    await page.waitForSelector(
                        `span[title="${subProjectMonitorName}"]`
                    );
                    await page.click(
                        `span[title="${subProjectMonitorName}"]`
                    );
                    await page.waitForSelector('#btnSaveMonitors');
                    await page.click('#btnSaveMonitors');
                    await page.waitForTimeout(5000);

                    const monitorSelectValue = await page.$eval(
                        'input[type=checkbox]',
                        el => el.value
                    );
                    expect(monitorSelectValue).toBe('true');
                            
            done();
        },
        operationTimeOut
    );

    test(
        'should delete sub-project schedule',
        async done => {
                    await page.goto(utils.DASHBOARD_URL);                        
                    await page.waitForSelector('#onCallDuty');
                    await page.click('#onCallDuty');
                    await page.waitForSelector('tr.scheduleListItem');
                    await page.click('tr.scheduleListItem');
                    await page.waitForSelector('#delete');
                    await page.click('#delete');
                    await page.waitForSelector('#confirmDelete');
                    await page.click('#confirmDelete');
                    await page.waitForSelector('#confirmDelete', {hidden: true});

                    await page.waitForSelector('#onCallDuty');
                    await page.click('#onCallDuty');
                    await page.waitForSelector('tr.scheduleListItem');

                    const scheduleRows = await page.$$('tr.scheduleListItem');
                    const countSchedules = scheduleRows.length;

                    expect(countSchedules).toEqual(10);                

            done();
        },
        operationTimeOut
    );
});

