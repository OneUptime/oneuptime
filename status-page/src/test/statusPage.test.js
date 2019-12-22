var puppeteer = require('puppeteer');
var expect = require('chai').expect;
var chai = require('chai');
chai.use(require('chai-http'));

var app = 'http://localhost:3002';
var request = chai.request(app);

var token, authorization, projectId, monitorCategoryId, monitorId, statusPageId, userId;
var testData = require('./data/data');
var VerificationTokenModel = require('../../../backend/backend/models/verificationToken');
var UserService = require('../../../backend/backend/services/userService');
var payment = require('../../../backend/backend/config/payment');
var stripe = require('stripe')(payment.paymentPrivateKey);
var monitor = testData.monitor;
var monitorCategory = testData.monitorCategory;
var statusPage = testData.statusPage;


var browser, page, statusPageURL;


describe('Status page monitors check', function () {
    this.timeout(30000);
    before(async function () {
        this.enableTimeouts(false);
        await UserService.hardDeleteBy({ email: testData.user.email });

        var checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: testData.user.email,
            companyName: testData.user.companyName
        });
        var confirmedPaymentIntent = await stripe.paymentIntents.confirm(checkCardData.body.id);

        var signUpRequest = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id
            },
            ...testData.user
        });

        projectId = signUpRequest.body.project._id;

        userId = signUpRequest.body.id;
        var verificationToken = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch (error) {
            //catch
        }

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
        monitorId = monitorRequest.body[0]._id;
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


        statusPageURL = `http://${statusPageId}.localhost:3006/`;

        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(statusPageURL, {
            waitUntil: 'networkidle0'
        });
    });

    after(async function () {
        if (browser) {
            await browser.close();
        }
        await UserService.hardDeleteBy({ _id: userId })
    });

    it('Status page should have one monitor with a category', async function () {
        let monitorName = await page.$eval('#monitor0 > div.uptime-graph-header.clearfix > span.uptime-stat-name', el => el.textContent);
        expect(monitorName).to.be.equal(monitor.name);
    });

    it('Status page add one more monitor and the monitor count should be 2', async function () {
        monitor.name = 'New monitor Second'
        var monitorRequest = await request.post(`/monitor/${projectId}`)
            .set('Authorization', authorization).send(monitor)
        monitorId = monitorRequest.body[0]._id;
        statusPage.monitorIds.push(monitorId);
        await request.put(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send({
                _id: statusPageId,
                monitorIds: statusPage.monitorIds
            })
        await page.reload({
            waitUntil: 'networkidle0'
        });
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
        monitorId = monitorRequest.body[0]._id;
        statusPage.monitorIds.push(monitorId);
        await request.put(`/statusPage/${projectId}`)
            .set('Authorization', authorization).send({
                _id: statusPageId,
                monitorIds: statusPage.monitorIds
            })
        await page.reload({
            waitUntil: 'networkidle0'
        });
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
        await page.reload({
            waitUntil: 'networkidle0'
        });
        let monitorCategoryNameSelector = '#monitorCategory0';
        let monitorCategoryName = await page.$eval(monitorCategoryNameSelector, el => el.textContent);
        expect(monitorCategoryName).to.be.equal(monitorCategory.monitorCategoryName.toUpperCase());
    });

    it('should display "UNCATEGORIZED" when the monitor category associated with monitor is deleted', async function () {
        await request.delete(`/monitorCategory/${projectId}/${monitorCategoryId}`)
            .set('Authorization', authorization)
        await page.reload({
            waitUntil: 'networkidle0'
        });
        let monitorCategoryNameSelector = '#monitorCategory0'
        let monitorCategoryName = await page.$eval(monitorCategoryNameSelector, el => el.textContent);
        expect(monitorCategoryName).to.be.equal('UNCATEGORIZED');
    });

});