var puppeteer = require('puppeteer');
var expect = require('chai').expect;
var chai = require('chai');
chai.use(require('chai-http'));

var app = 'http://localhost:3006';
var request = chai.request(app);

var token, authorization, projectId, monitorCategoryId, monitorId, statusPageId;
var testData = require('./data/data');
var monitor = testData.monitor;
var monitorCategory = testData.monitorCategory;
var statusPage = testData.statusPage;

var browser, page, statusPageURL;


describe('Status page monitors check', function () {

    before(async function () {
        this.enableTimeouts(false);

        var signUpRequest = await request.post('/user/signup').send(testData.user)
        projectId = signUpRequest.body.project._id;

        var loginRequest = await request.post('/user/login')
            .send({ email: testData.user.email, password: testData.user.password })
        token = loginRequest.body.tokens.jwtAccessToken;

        authorization = `Basic ${token}`;

        var monitorCategoryRequest = await request.post(`/monitorCategory/${projectId}`)
            .set('Authorization', authorization).send(monitorCategory)
        monitorCategoryId = monitorCategoryRequest.body._id;
        monitor.monitorCategoryId = monitorCategoryId;

        var monitorRequest = await request.post(`/monitor/${projectId}`)
            .set('Authorization', authorization).send(monitor)
        monitorId = monitorRequest.body._id;
        statusPage.projectId = projectId;
        statusPage.monitorIds = [monitorId];


        var statusPageRequest = await request.post(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send(statusPage)
        statusPageId = statusPageRequest.body._id;

        await request.put(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send({
                _id: statusPageId,
                monitorIds: [monitorId]
            })


        statusPageURL = `http://${statusPageId}.localhost:3001/`;

        browser = await puppeteer.launch({ headless: false });
        page = await browser.newPage();
        await page.emulate({
            viewport: {
                width: 1024,
                height: 720
            },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        });
        await page.goto(statusPageURL, {
            waitUntil: 'networkidle0'
        });
    });

    after(async function () {
        await browser.close();
    });

    it('Status page should have one monitor with a category', async function () {
        let monitorName = await page.$eval('#root > div > div > div.content > div > div.statistics > div.uptime-graphs.box-inner > div > div.uptime-graph-header.clearfix > span.uptime-stat-name', el => el.textContent);
        expect(monitorName).to.be.equal(monitor.name);
    });

    it('Status page add one more monitor and the monitor count should be 2', async function () {

        monitor.name = 'New monitor Second'
        var monitorRequest = await request.post(`/monitor/${projectId}`)
            .set('Authorization', authorization).send(monitor)
        monitorId = monitorRequest.body._id;

        statusPage.monitorIds.push(monitorId);

        await request.put(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send({
                _id: statusPageId,
                monitorIds: statusPage.monitorIds
            })
        await page.reload();

        await page.waitFor(() => !!document.getElementsByClassName('uptime-graph-section dashboard-uptime-graph'))

        var noOfMonitors = await page.evaluate(() => {
            let monitors = document.getElementsByClassName('uptime-graph-section dashboard-uptime-graph');
            return monitors.length;
        });

        expect(noOfMonitors).to.be.equal(2);
    });

    it('should be able to add monitor without monitor category and the count should be 3', async function () {
        monitor.name = 'New monitor without monitor category';
        delete monitor.monitorCategoryId;

        var monitorRequest = await request.post(`/monitor/${projectId}`)
            .set('Authorization', authorization).send(monitor)
        monitorId = monitorRequest.body._id;
        statusPage.monitorIds.push(monitorId);

        await request.put(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send({
                _id: statusPageId,
                monitorIds: statusPage.monitorIds
            })

        await page.reload();

        await page.waitFor(() => !!document.getElementsByClassName('uptime-graph-section dashboard-uptime-graph'))

        var noOfMonitors = await page.evaluate(() => {
            let monitors = document.getElementsByClassName('uptime-graph-section dashboard-uptime-graph');
            return monitors.length;
        });

        expect(noOfMonitors).to.be.equal(3);

    })

    it('should be displayed category wise', async function () {

        await request.put(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send({
                _id: statusPageId,
                isGroupedByMonitorCategory: true
            });

        await page.reload();

        await page.waitFor(() => !!document.getElementsByClassName('uptime-graph-section dashboard-uptime-graph'));

        let monitorCategoryNameSelector = '#root > div > div > div.content > div > div.statistics > div.uptime-graphs.box-inner > div > div:nth-child(1) > span'
        let monitorCategoryName = await page.$eval(monitorCategoryNameSelector, el => el.textContent);
        expect(monitorCategoryName).to.be.equal(monitorCategory.monitorCategoryName.toUpperCase());
    });

    it('should display "UNCATEGORIZED" when the monitor category associated with monitor is deleted', async function () {

        await request.delete(`/monitorCategory/${projectId}/${monitorCategoryId}`)
            .set('Authorization', authorization)

        await page.reload();

        await page.waitFor(() => !!document.getElementsByClassName('uptime-graph-section dashboard-uptime-graph'));

        let monitorCategoryNameSelector = '#root > div > div > div.content > div > div.statistics > div.uptime-graphs.box-inner > div:nth-child(1) > div:nth-child(1) > span'
        let monitorCategoryName = await page.$eval(monitorCategoryNameSelector, el => el.textContent);
        expect(monitorCategoryName).to.be.equal('UNCATEGORIZED');

    });

});