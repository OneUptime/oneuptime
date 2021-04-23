const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
//const { Cluster } = require('puppeteer-cluster');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user ={
    email,
    password
}
describe('Enterprise Monitor SubProject API', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        // const cluster = await Cluster.launch({
        //     concurrency: Cluster.CONCURRENCY_PAGE,
        //     puppeteerOptions: utils.puppeteerLaunchConfig,
        //     puppeteer,
        //     timeout: 120000,
        // });

        // cluster.on('taskerror', err => {
        //     throw err;
        // });
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user
        // await cluster.task(async ({ page, data }) => {
        //     const user = {
        //         email: data.email,
        //         password: data.password,
        //     };
            // user
            await init.registerEnterpriseUser(user, page);
       // });

        // await cluster.queue({ email, password });

        // await cluster.idle();
        
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should create a monitor in sub-project for valid `admin`',
        async done => {
            // const cluster = await Cluster.launch({
            //     concurrency: Cluster.CONCURRENCY_PAGE,
            //     puppeteerOptions: utils.puppeteerLaunchConfig,
            //     puppeteer,
            //     timeout: utils.timeout,
            // });

            // cluster.on('taskerror', err => {
            //     throw err;
            // });

            const subProjectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            const subProjectMonitorName = utils.generateRandomString();

            //await cluster.task(async ({ page, data }) => {
                // const user = {
                //     email: data.email,
                //     password: data.password,
                // };

                await init.adminLogout(page);
                await init.loginUser(user, page);

                // add sub-project
                await init.addSubProject(subProjectName, page);

                // Create Component first
                // Redirects automatically component to details page
                await init.addComponent(componentName, page);

                // switch to invited project for new user
                await page.waitForSelector('#monitors');
                await page.waitForSelector('#form-new-monitor', {visible: true});
                await page.click('input[id=name]');
                await page.type('input[id=name]', subProjectMonitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', {visible: true});
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');                

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${subProjectMonitorName}`, {visible: true}
                );

                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).toBe(subProjectMonitorName);
           // });

            // cluster.queue({
            //     email,
            //     password,
            //     subProjectName,
            //     componentName,
            //     subProjectMonitorName,
            // });
            // await cluster.idle();
            // await cluster.close();
            done();
        },
        operationTimeOut
    );
});
