const utils = require('./test-utils');
const puppeteer = require('puppeteer');
const init = require('./test-init');

let page, browser;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const projectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();

describe('Check status-page up', () => {
    beforeAll(async done => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test('should load status page and show status page is not present', async done => {
        await page.goto(`${utils.STATUSPAGE_URL}/fakeStatusPageId`, {
            waitUntil: 'domcontentloaded',
        });        
        await page.waitForSelector('#app-loading',{visible:true});
        const response = await page.$eval('#app-loading > div', e => {
            return e.innerHTML;
        });
        expect(response).toBe('Page Not Found');
        done();
    }, 30000);

    test('should create a status-page', async done => {
        await init.registerUser(user, page);
        await init.renameProject(projectName, page);

        // Create a Status-Page with a Manual Monitor and Display the Monitor in Status-Page Url
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages',{visible:true});
        await page.click('#statusPages');
        await page.waitForSelector(`#btnCreateStatusPage_${projectName}`,{visible:true});
        await page.click(`#btnCreateStatusPage_${projectName}`);
        await page.waitForSelector('#name',{visible:true});
        await page.click('input[id=name]');
        await page.type('input[id=name]', statusPageName);
        await page.click('#btnCreateStatusPage');
        await page.waitForSelector('#statusPagesListContainer',{visible:true});
        await page.waitForSelector('#viewStatusPage',{visible:true});
        await page.click('#viewStatusPage');
        await page.waitForSelector(`#header-${statusPageName}`,{visible:true});

        // To confirm the status-page name.
        let spanElement = await page.waitForSelector(
            `#header-${statusPageName}`,{visible:true}
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(statusPageName);

        done();
    }, 200000);

    test('should create a manual monitor', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#components',{visible:true});
        await page.$eval('#components', el => el.click());
        // Fill and submit New Component form
        await init.addComponent(componentName, page);        
        // Create a Manual Monitor
        await init.addMonitor(monitorName, page);        
        // To confirm the manual monitor is created.
        let spanElement = await page.waitForSelector(
            `#monitor-title-${monitorName}`,{visible:true}
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    }, 200000);

    test('should add monitor to status-page', async done => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await page.waitForSelector('#statusPages',{visible:true});
        await page.click('#statusPages');
        await page.waitForSelector('#statusPagesListContainer',{visible:true});
        await page.waitForSelector('#viewStatusPage',{visible:true});
        await page.click('#viewStatusPage');
        await page.waitForSelector('#addMoreMonitors',{visible:true});
        await page.click('#addMoreMonitors');
        await init.selectByText(
            '#monitor-name',
            `${componentName} / ${monitorName}`,
            page
        );
        await page.click('#monitor-description');
        await page.type('#monitor-description', 'Status Page Description');
        await page.click('#manual-monitor-checkbox');
        await page.click('#btnAddStatusPageMonitors');

        await page.waitForSelector('#publicStatusPageUrl',{visible:true});
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link);

        // To confirm the monitor is present in the status-page
        let spanElement = await page.waitForSelector(`#monitor-${monitorName}`,{visible:true});
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        expect(spanElement).toMatch(monitorName);

        done();
    }, 200000);

    // test('should add more monitors and see if they are present on the status-page', async done => {
    //     // This creates 2 additonal monitors
    //     for (let i = 0; i < 2; i++) {
    //         await init.navigateToComponentDetails(componentName, page);
    //         const monitorName = utils.generateRandomString();
    //         const description = utils.generateRandomString();
    //         await page.waitForSelector('#form-new-monitor', { visible: true });
    //         await page.click('input[id=name]', { visible: true });
    //         await page.type('input[id=name]', monitorName);
    //         await page.click('[data-testId=type_manual]');
    //         await page.waitForSelector('#description',{visible:true});
    //         await page.click('#description');
    //         await page.type('#description', description);
    //         await page.click('button[type=submit]');
    //         await page.waitForSelector(`#monitor-title-${monitorName}`,{visible:true});

    //         await init.addMonitorToStatusPage(componentName, monitorName, page);
    //     }

    //     // To confirm the monitors on status-page
    //     await page.waitForSelector('#publicStatusPageUrl',{visible:true});
    //     let link = await page.$('#publicStatusPageUrl > span > a');
    //     link = await link.getProperty('href');
    //     link = await link.jsonValue();
    //     await page.goto(link);

    //     await page.waitForSelector('.monitor-list',{visible:true});
    //     const monitor = await page.$$('.monitor-list');
    //     const monitorLength = monitor.length;
    //     expect(monitorLength).toEqual(3);

    //     done();
    // }, 200000);

    // test('should create an offline incident and view it on status-page', async done => {
    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });

    //     await page.waitForSelector('#components',{visible:true});
    //     await page.$eval('#components', el => el.click());
    //     await page.waitForSelector(`#view-resource-${monitorName}`,{visible:true});
    //     await page.click(`#view-resource-${monitorName}`);
    //     await page.waitForSelector(`#monitorCreateIncident_${monitorName}`,{visible:true});
    //     await page.click(`#monitorCreateIncident_${monitorName}`);
    //     await page.waitForSelector('#incidentTitleLabel',{visible:true});
    //     await page.click('#createIncident');

    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });

    //     await page.waitForSelector('#viewIncident-0',{visible:true});
    //     await page.click('#closeIncident_0');
    //     await page.waitForSelector('#closeIncident_0', { hidden: true });

    //     await init.navigateToStatusPage(page);
    //     await page.reload({
    //         waitUntil: 'networkidle0',
    //     });
    //     let spanElement = await page.waitForSelector('#status-note',{visible:true});
    //     spanElement = await spanElement.getProperty('innerText');
    //     spanElement = await spanElement.jsonValue();
    //     expect(spanElement).toMatch('Some resources are offline');

    //     done();
    // }, 200000);

    // test('should resolve offline incident and view status-page', async done => {
    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });
    //     await page.waitForSelector('#btnAcknowledge_0',{visible:true});
    //     await page.click('#btnAcknowledge_0');
    //     await page.waitForSelector('#btnResolve_0',{visible:true});
    //     await page.click('#btnResolve_0');

    //     await page.reload({
    //         waitUntil: 'networkidle2',
    //     });
    //     await init.navigateToStatusPage(page);
    //     let spanElement = await page.waitForSelector('#status-note',{visible:true});
    //     spanElement = await spanElement.getProperty('innerText');
    //     spanElement = await spanElement.jsonValue();
    //     expect(spanElement).toMatch('All resources are operational');
    //     done();
    // }, 200000);

    // test('should create an degraded incident and view it on status-page', async done => {
    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });

    //     await page.waitForSelector('#components',{visible:true});
    //     await page.$eval('#components', el => el.click());
    //     await page.waitForSelector(`#view-resource-${monitorName}`,{visible:true});
    //     await page.click(`#view-resource-${monitorName}`);
    //     await page.waitForSelector(`#monitorCreateIncident_${monitorName}`,{visible:true});
    //     await page.click(`#monitorCreateIncident_${monitorName}`);
    //     await page.waitForSelector('#incidentTitleLabel',{visible:true});
    //     await init.selectByText('#incidentType', 'Degraded', page);
    //     await page.click('#createIncident');

    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });

    //     await page.waitForSelector('#viewIncident-0',{visible:true});
    //     await page.click('#closeIncident_0');
    //     await page.waitForSelector('#closeIncident_0', { hidden: true });

    //     await init.navigateToStatusPage(page);
    //     await page.reload({
    //         waitUntil: 'networkidle0',
    //     });
    //     let spanElement = await page.waitForSelector('#status-note',{visible:true});
    //     spanElement = await spanElement.getProperty('innerText');
    //     spanElement = await spanElement.jsonValue();
    //     expect(spanElement).toMatch('Some resources are degraded');

    //     done();
    // }, 200000);

    // test('should resolve degraded incident and view status-page', async done => {
    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });
    //     await page.waitForSelector('#btnAcknowledge_0',{visible:true});
    //     await page.click('#btnAcknowledge_0');
    //     await page.waitForSelector('#btnResolve_0',{visible:true});
    //     await page.click('#btnResolve_0');

    //     await page.reload({
    //         waitUntil: 'networkidle2',
    //     });
    //     await init.navigateToStatusPage(page);
    //     let spanElement = await page.waitForSelector('#status-note',{visible:true});
    //     spanElement = await spanElement.getProperty('innerText');
    //     spanElement = await spanElement.jsonValue();
    //     expect(spanElement).toMatch('All resources are operational');
    //     done();
    // }, 200000);

    // test('should create an offline incident and confirm the description note on status-page', async done => {
    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });
    //     const note = utils.generateRandomString();
    //     await page.waitForSelector('#components',{visible:true});
    //     await page.$eval('#components', el => el.click());
    //     await page.waitForSelector(`#view-resource-${monitorName}`,{visible:true});
    //     await page.click(`#view-resource-${monitorName}`);
    //     await page.waitForSelector(`#monitorCreateIncident_${monitorName}`,{visible:true});
    //     await page.click(`#monitorCreateIncident_${monitorName}`);
    //     await page.waitForSelector('#incidentTitleLabel',{visible:true});
    //     await page.click('#description', { clickCount: 3 });
    //     await page.keyboard.down('Control');
    //     await page.keyboard.press('A');
    //     await page.keyboard.up('Control');
    //     await page.type('#description', note);
    //     await page.click('#createIncident');

    //     await page.goto(utils.DASHBOARD_URL, {
    //         waitUntil: 'networkidle2',
    //     });

    //     await page.waitForSelector('#viewIncident-0',{visible:true});
    //     await page.click('#closeIncident_0');
    //     await page.waitForSelector('#closeIncident_0', { hidden: true });

    //     await init.navigateToStatusPage(page);
    //     await page.reload({
    //         waitUntil: 'networkidle0',
    //     });
    //     let spanElement = await page.waitForSelector('#note', {
    //         visible: true,
    //     });
    //     spanElement = await spanElement.getProperty('innerText');
    //     spanElement = await spanElement.jsonValue();
    //     expect(spanElement).toMatch(note);
    //     done();
    // }, 200000);
});
