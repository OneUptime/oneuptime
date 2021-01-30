const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

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

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            // user
            await init.registerUser(user, page);
            await init.registerUser(member, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should render the API page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#api');
                await page.click('#api a');
                let elementHandle = await page.$('#boxTitle', {
                    visible: true,
                });
                elementHandle = await elementHandle.getProperty('innerText');
                elementHandle = await elementHandle.jsonValue();
                elementHandle.should.be.exactly('API Documentation');
            });
        },
        operationTimeOut
    );

    test(
        'Should display the API key when clicked',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#api');
                await page.click('#api a');
                let label = await page.$('#apiKey', { visible: true });
                label = await label.getProperty('innerText');
                label = await label.jsonValue();

                await page.click('#apiKey');
                let newLabel = await page.$('#apiKey', { visible: true });
                newLabel = await newLabel.getProperty('innerText');
                newLabel = await newLabel.jsonValue();
                expect(label).not.toEqual(newLabel);
            });
        },
        operationTimeOut
    );

    test(
        'Should reset the API Key',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#api');
                await page.click('#api a');

                await page.click('#apiKey');
                let oldApiKey = await page.$('#apiKey', { visible: true });
                oldApiKey = await oldApiKey.getProperty('innerText');
                oldApiKey = await oldApiKey.jsonValue();

                await page.click('button[id=resetApiKey]', { delay: 100 });
                await page.waitForSelector('button[id=resetApiKeySave]');
                await page.click('button[id=resetApiKeySave]');
                await page.waitForTimeout(2000);

                let newApiKey = await page.$('#apiKey', { visible: true });
                newApiKey = await newApiKey.getProperty('innerText');
                newApiKey = await newApiKey.jsonValue();

                expect(oldApiKey).not.toEqual(newApiKey);
            });
        },
        operationTimeOut
    );

    test(
        'Should not access API settings if user is a member on a project',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                // Rename project
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('input[name=project_name]');
                await page.click('input[name=project_name]', { clickCount: 3 });
                await page.type('input[name=project_name]', projectName);
                await page.waitForSelector('button[id=btnCreateProject]');
                await page.click('button[id=btnCreateProject]');

                // Invite member on the project
                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${projectName}`);
                await page.click(`#btn_${projectName}`);
                await page.waitForSelector('input[name=emails]');
                await page.click('input[name=emails]');
                await page.type('input[name=emails]', member.email);
                await page.waitForSelector(`#${role}_${projectName}`);
                await page.click(`#${role}_${projectName}`);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                await page.waitForTimeout(5000);
                await init.logout(page);

                // Login as member
                await init.loginUser(member, page);
                await init.switchProject(projectName, page);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#api');
                await page.click('#api a');
                let elementHandle = await page.$('#boxTitle', {
                    visible: true,
                });
                expect(elementHandle).toEqual(null);

                elementHandle = await page.$('#errorMessage', {
                    visible: true,
                });
                expect(elementHandle).not.toBe(null);
            });
        },
        operationTimeOut
    );
});
