
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const secondEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';
const teamEmail = utils.generateRandomBusinessEmail();
const newProjectName = 'Test';
const subProjectName = 'Trial';
let browser: $TSFixMe, page: $TSFixMe;

describe('Project Setting: Change Plan', () => {
    const operationTimeOut = init.timeout;

    
    beforeAll(async (done: $TSFixMe) => {
        
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // user
        await init.registerUser(user, page);

        done();
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test(
        'should change project plan',
        async () => {
            await init.growthPlanUpgrade(page);
            await page.reload({ waitUntil: 'networkidle0' });
            
            await init.pageWaitForSelector(page, 'input#Growth_month');
            const checked = await init.page$Eval(
                page,
                'input#Growth_month',
                (input: $TSFixMe) => input.checked
            );
            expect(checked).toBe(true);
        },
        operationTimeOut
    );
    
    test(
        'should not update project account when admin recharge account with negative number',
        async (done: $TSFixMe) => {
            const balance = 0;
            let creditedBalance = 0;
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageWaitForSelector(page, '#billing');
            
            await init.pageClick(page, '#billing');

            // get current balance as $0
            
            let spanBalanceElement = await init.pageWaitForSelector(
                page,
                '#currentBalance'
            );
            spanBalanceElement = await spanBalanceElement.getProperty(
                'innerText'
            );
            spanBalanceElement = await spanBalanceElement.jsonValue();
            expect(spanBalanceElement).toMatch(`${balance}.00$`);

            // add $20 to the account then click cancel
            
            await init.pageWaitForSelector(page, '#rechargeBalanceAmount');
            
            await init.pageClick(page, '#rechargeBalanceAmount');
            creditedBalance = -20;
            
            await init.pageType(
                page,
                '#rechargeBalanceAmount',
                creditedBalance.toString()
            );
            
            await init.pageClick(page, '#rechargeAccount');

            // confirm the current balance is still $0
            
            spanBalanceElement = await init.pageWaitForSelector(
                page,
                '#field-error'
            );
            spanBalanceElement = await spanBalanceElement.getProperty(
                'innerText'
            );
            spanBalanceElement = await spanBalanceElement.jsonValue();
            expect(spanBalanceElement).toMatch(
                `Enter a valid number greater than 0`
            );

            done();
        },
        operationTimeOut
    );
    
    test(
        'should update project account when admin recharge account',
        async (done: $TSFixMe) => {
            let balance = 0,
                creditedBalance = 0;
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageWaitForSelector(page, '#billing');
            
            await init.pageClick(page, '#billing');

            // get current balance as $0
            
            let spanBalanceElement = await init.pageWaitForSelector(
                page,
                '#currentBalance'
            );
            spanBalanceElement = await spanBalanceElement.getProperty(
                'innerText'
            );
            spanBalanceElement = await spanBalanceElement.jsonValue();
            expect(spanBalanceElement).toMatch(`${balance}.00$`);

            // add $20 to the account
            
            await init.pageWaitForSelector(page, '#rechargeBalanceAmount');
            
            await init.pageClick(page, '#rechargeBalanceAmount');
            creditedBalance = 20;
            
            await init.pageType(
                page,
                '#rechargeBalanceAmount',
                creditedBalance.toString()
            );
            
            await init.pageClick(page, '#rechargeAccount');
            balance += creditedBalance;

            
            await init.pageWaitForSelector(page, '#confirmBalanceTopUp');
            
            await init.pageClick(page, '#confirmBalanceTopUp');
            await init.pageWaitForSelector(page, '#confirmBalanceTopUp', {
                hidden: true,
            });

            // confirm a pop up comes up and the message is a successful
            
            let spanModalElement = await init.pageWaitForSelector(
                page,
                '#message-modal-message'
            );
            spanModalElement = await spanModalElement.getProperty('innerText');
            spanModalElement = await spanModalElement.jsonValue();
            expect(spanModalElement).toMatch(
                `Transaction successful, your balance is now ${balance}.00$`
            );

            // click ok
            
            await init.pageWaitForSelector(page, '#modal-ok');
            
            await init.pageClick(page, '#modal-ok');
            await init.pageWaitForSelector(page, '#modal-ok', { hidden: true });

            // confirm the current balance is $20
            
            spanBalanceElement = await init.pageWaitForSelector(
                page,
                '#currentBalance'
            );
            spanBalanceElement = await spanBalanceElement.getProperty(
                'innerText'
            );
            spanBalanceElement = await spanBalanceElement.jsonValue();
            expect(spanBalanceElement).toMatch(`${balance}.00$`);

            done();
        },
        operationTimeOut
    );
    
    test(
        'should not update project account when admin recharge account and clicks cancel',
        async (done: $TSFixMe) => {
            const balance = 0;
            let creditedBalance = 0;
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageWaitForSelector(page, '#billing');
            
            await init.pageClick(page, '#billing');

            // get current balance as $0
            
            let spanBalanceElement = await init.pageWaitForSelector(
                page,
                '#currentBalance'
            );
            spanBalanceElement = await spanBalanceElement.getProperty(
                'innerText'
            );
            spanBalanceElement = await spanBalanceElement.jsonValue();
            expect(spanBalanceElement).toMatch(`${balance}.00$`);

            // add $20 to the account then click cancel
            
            await init.pageWaitForSelector(page, '#rechargeBalanceAmount');
            
            await init.pageClick(page, '#rechargeBalanceAmount');
            creditedBalance = 20;
            
            await init.pageType(
                page,
                '#rechargeBalanceAmount',
                creditedBalance.toString()
            );
            
            await init.pageClick(page, '#rechargeAccount');

            
            await init.pageWaitForSelector(page, '#confirmBalanceTopUp');
            
            await init.pageClick(page, '#cancelBalanceTopUp');
            await init.pageWaitForSelector(page, '#cancelBalanceTopUp', {
                hidden: true,
            });

            // confirm the current balance is still $0
            
            spanBalanceElement = await init.pageWaitForSelector(
                page,
                '#currentBalance'
            );
            spanBalanceElement = await spanBalanceElement.getProperty(
                'innerText'
            );
            spanBalanceElement = await spanBalanceElement.jsonValue();
            expect(spanBalanceElement).toMatch(`${balance}.00$`);

            done();
        },
        operationTimeOut
    );
});


describe('Member Restriction', () => {
    const operationTimeOut = init.timeout;

    
    beforeAll(async (done: $TSFixMe) => {
        
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: secondEmail,
            password: password,
        };

        // user
        await init.registerUser(user, page);
        await init.renameProject(newProjectName, page);
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        await init.addUserToProject(
            {
                email: teamEmail,
                role: 'Member',
                subProjectName: newProjectName,
            },
            page
        );
        await init.growthPlanUpgrade(page);
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        // adding a subProject is only allowed on growth plan and above
        await init.addSubProject(subProjectName, page);
        await init.saasLogout(page);

        done();
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test(
        'should show unauthorised modal when a team member who is not an admin or owner of the project tries to update alert option',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(
                { email: teamEmail, password },
                page
            );
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageWaitForSelector(page, '#billing');
            
            await init.pageClick(page, '#billing');
            await init.pageWaitForSelector(page, '#alertEnable', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(
                page,
                '#alertEnable',
                (checkbox: $TSFixMe) => checkbox.click
            );
            
            await init.pageClick(page, '#alertOptionSave');
            const unauthorisedModal = await init.pageWaitForSelector(
                page,
                '#unauthorisedModal',
                { visible: true, timeout: init.timeout }
            );
            expect(unauthorisedModal).toBeDefined();

            done();
        },
        operationTimeOut
    );

    
    test(
        'should show unauthorised modal when a team member who is not an admin or owner of the project tries to recharge account',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageWaitForSelector(page, '#billing');
            
            await init.pageClick(page, '#billing');
            
            await init.pageWaitForSelector(page, '#rechargeBalanceAmount');
            
            await init.pageClick(page, '#rechargeBalanceAmount');
            
            await init.pageType(page, '#rechargeBalanceAmount', '20');
            
            await init.pageClick(page, '#rechargeAccount');
            const unauthorisedModal = await init.pageWaitForSelector(
                page,
                '#unauthorisedModal',
                { visible: true, timeout: init.timeout }
            );
            expect(unauthorisedModal).toBeDefined();

            done();
        },
        operationTimeOut
    );

    
    test(
        'should show unauthorised modal when a team member who is not an admin or owner of the project tries to change project plan',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageWaitForSelector(page, '#billing');
            
            await init.pageClick(page, '#billing');
            await init.pageWaitForSelector(page, 'input#Startup_month', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, 'input#Startup_month');
            
            await init.pageClick(page, '#changePlanBtn');
            const unauthorisedModal = await init.pageWaitForSelector(
                page,
                '#unauthorisedModal',
                { visible: true, timeout: init.timeout }
            );
            expect(unauthorisedModal).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
