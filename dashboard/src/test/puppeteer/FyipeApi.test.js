const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const member = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('API test', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async (done) => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );  

        // Register user     
            await init.registerUser(user, page);
            await init.logout(page);
            await init.registerUser(member, page);
            await init.logout(page);
            await init.loginUser(user, page);
       
        done();
    });

    afterAll(async (done) => {       
        await browser.close();
        done();
    });

    test(
        'Should render the API page',
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('#api', {visible: true});
                await page.click('#api a');
                let elementHandle = await page.$('#boxTitle', {
                    visible: true,
                });
                elementHandle = await elementHandle.getProperty('innerText');
                elementHandle = await elementHandle.jsonValue();
                elementHandle.should.be.exactly('API Documentation');
           
           done();
        },
        operationTimeOut
    );

    test(
        'Should display the API key when clicked',
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('#api', {visible: true});
                await page.click('#api a');
                let label = await page.$('#apiKey', { visible: true });
                label = await label.getProperty('innerText');
                label = await label.jsonValue();

                await page.click('#apiKey');
                let newLabel = await page.$('#apiKey', { visible: true });
                newLabel = await newLabel.getProperty('innerText');
                newLabel = await newLabel.jsonValue();
                expect(label).not.toEqual(newLabel);

                done();
            
        },
        operationTimeOut
    );

    test(
        'Should reset the API Key',
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('#api', {visible: true});
                await page.click('#api a');

                await page.click('#apiKey');
                let oldApiKey = await page.$('#apiKey', { visible: true });
                oldApiKey = await oldApiKey.getProperty('innerText');
                oldApiKey = await oldApiKey.jsonValue();

                await page.click('button[id=resetApiKey]', { delay: 100 });
                await page.waitForSelector('button[id=resetApiKeySave]', {visible: true});
                await page.click('button[id=resetApiKeySave]');
                await page.waitForSelector('button[id=resetApiKeySave]', {hidden:true});

                let newApiKey = await page.$('#apiKey', { visible: true });
                newApiKey = await newApiKey.getProperty('innerText');
                newApiKey = await newApiKey.jsonValue();

                expect(oldApiKey).not.toEqual(newApiKey);

                done();
           
        },
        operationTimeOut
    );

    test(
        'Should not access API settings if user is a member on a project',
        async (done) => {
            const projectName = 'Project1';
            const role = 'Member';
                        
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // Rename project
                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('input[name=project_name]', {visible: true});
                await page.click('input[name=project_name]', { clickCount: 3 });
                await page.type('input[name=project_name]', projectName);
                await page.waitForSelector('button[id=btnCreateProject]', {visible: true});
                await page.click('button[id=btnCreateProject]');

                // Invite member on the project
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#teamMembers', {visible: true});
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${projectName}`, {visible: true});
                await page.click(`#btn_${projectName}`);
                await page.waitForSelector('input[name=emails]', {visible: true});
                await page.click('input[name=emails]');
                await page.type('input[name=emails]', member.email);
                await page.waitForSelector(`#${role}_${projectName}`, {visible: true});
                await page.click(`#${role}_${projectName}`);
                await page.waitForSelector('button[type=submit]', {visible: true});
                await page.click('button[type=submit]');
                await page.waitForSelector('button[type=submit]', {hidden: true});
                await init.logout(page);

                // Login as member
                await init.loginUser(member, page);
                await init.switchProject(projectName, page);
                await page.waitForSelector('#projectSettings', {visible: true});
                await page.click('#projectSettings');
                await page.waitForSelector('#api', {visible: true});
                await page.click('#api a');
                let elementHandle = await page.$('#boxTitle', {
                    visible: true,
                });
                expect(elementHandle).toEqual(null);

                elementHandle = await page.$('#errorMessage', {
                    visible: true,
                });
                expect(elementHandle).not.toBe(null);
                done();
           
        },
        operationTimeOut
    );
});
