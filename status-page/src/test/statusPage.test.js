/* eslint-disable no-undef */

// Load env vars from the backend.
require('custom-env').env(null, '../backend');

const puppeteer = require('puppeteer');
const expect = require('chai').expect;
const chai = require('chai');
chai.use(require('chai-http'));

const app = 'http://localhost:3002';
const request = chai.request(app);

const ACCOUNTS_URL = 'http://localhost:3003/accounts';

let token,
    authorization,
    projectId,
    monitorCategoryId,
    monitorId,
    statusPageId,
    privateStatusPageId,
    userId;
const testData = require('./data/data');
const VerificationTokenModel = require('../../../backend/backend/models/verificationToken');
const UserService = require('../../../backend/backend/services/userService');
const payment = require('../../../backend/backend/config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const monitor = testData.monitor;
const monitorCategory = testData.monitorCategory;
const statusPage = testData.statusPage;
const privateStatusPage = testData.privateStatusPage;

let browser, page, statusPageURL;

describe('Status page monitors check', function() {
    this.timeout(30000);
    before(async function() {
        this.enableTimeouts(false);
        await UserService.hardDeleteBy({ email: testData.user.email });

        const checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: testData.user.email,
            companyName: testData.user.companyName,
        });
        const confirmedPaymentIntent = await stripe.paymentIntents.confirm(
            checkCardData.body.id
        );

        const signUpRequest = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id,
            },
            ...testData.user,
        });

        projectId = signUpRequest.body.project._id;

        userId = signUpRequest.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        try {
            await request
                .get(`/user/confirmation/${verificationToken.token}`)
                .redirects(0);
        } catch (error) {
            //catch
        }

        const loginRequest = await request.post('/user/login').send({
            email: testData.user.email,
            password: testData.user.password,
        });
        token = loginRequest.body.tokens.jwtAccessToken;

        authorization = `Basic ${token}`;

        const monitorCategoryRequest = await request
            .post(`/monitorCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorCategory);
        monitorCategoryId = monitorCategoryRequest.body._id;
        monitor.monitorCategoryId = monitorCategoryId;

        const monitorRequest = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        monitorId = monitorRequest.body._id;
        statusPage.projectId = projectId;
        statusPage.monitorIds = [monitorId];

        const statusPageRequest = await request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send(statusPage);
        statusPageId = statusPageRequest.body._id;

        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                monitorIds: [monitorId],
            });

        statusPageURL = `http://${statusPageId}.localhost:3006/`;

        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(statusPageURL, {
            waitUntil: 'networkidle0',
        });
    });

    after(async function() {
        if (browser) {
            await browser.close();
        }
    });

    it('Status page should have one monitor with a category', async function() {
        const monitorName = await page.$eval(
            '#monitor0 > div.uptime-graph-header.clearfix > span.uptime-stat-name',
            el => el.textContent
        );
        expect(monitorName).to.be.equal(monitor.name);
    });

    it('Status page add one more monitor and the monitor count should be 2', async function() {
        monitor.name = 'New monitor Second';
        const monitorRequest = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        monitorId = monitorRequest.body._id;
        statusPage.monitorIds.push(monitorId);
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                monitorIds: statusPage.monitorIds,
            });
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const noOfMonitors = await page.evaluate(() => {
            const monitors = document.getElementsByClassName(
                'uptime-graph-section dashboard-uptime-graph'
            );
            return monitors.length;
        });
        expect(noOfMonitors).to.be.equal(2);
    });

    it('should be able to add monitor without monitor category and the count should be 3', async function() {
        monitor.name = 'New monitor without monitor category';
        delete monitor.monitorCategoryId;
        const monitorRequest = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        monitorId = monitorRequest.body._id;
        statusPage.monitorIds.push(monitorId);
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                monitorIds: statusPage.monitorIds,
            });
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const noOfMonitors = await page.evaluate(() => {
            const monitors = document.getElementsByClassName(
                'uptime-graph-section dashboard-uptime-graph'
            );
            return monitors.length;
        });
        expect(noOfMonitors).to.be.equal(3);
    });

    it('should be displayed category wise', async function() {
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                isGroupedByMonitorCategory: true,
            });
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const monitorCategoryNameSelector = '#monitorCategory1';
        const monitorCategoryName = await page.$eval(
            monitorCategoryNameSelector,
            el => el.textContent
        );
        expect(monitorCategoryName).to.be.equal(
            monitorCategory.monitorCategoryName.toUpperCase()
        );
    });

    it('should display "UNCATEGORIZED" when the monitor category associated with monitor is deleted', async function() {
        await request
            .delete(`/monitorCategory/${projectId}/${monitorCategoryId}`)
            .set('Authorization', authorization);
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const monitorCategoryNameSelector = '#monitorCategory0';
        const monitorCategoryName = await page.$eval(
            monitorCategoryNameSelector,
            el => el.textContent
        );
        expect(monitorCategoryName).to.be.equal('UNCATEGORIZED');
    });
});

let newBrowser, newPage, privateStatusPageURL;

describe('Private status page check', function() {
    this.timeout(30000);
    before(async function() {
        this.enableTimeouts(false);

        privateStatusPage.projectId = projectId;
        privateStatusPage.monitorIds = [monitorId];

        const statusPageRequest = await request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send(privateStatusPage);
        privateStatusPageId = statusPageRequest.body._id;

        privateStatusPageURL = `http://${privateStatusPageId}.localhost:3006/`;

        newBrowser = await puppeteer.launch({ headless: true });
        newPage = await newBrowser.newPage();
    });

    after(async function() {
        if (newBrowser) {
            await newBrowser.close();
        }
        await UserService.hardDeleteBy({ _id: userId });
    });

    it('should redirect to login for unauthorized user', async function() {
        await newPage.goto(privateStatusPageURL, {
            waitUntil: 'networkidle0',
        });
        expect(newPage.url()).to.be.equal(ACCOUNTS_URL + '/login');
    });

    it('should login and display monitor for user with valid `userId` and `accessToken`', async function() {
        await newPage.goto(
            `${privateStatusPageURL}?userId=${userId}&accessToken=${token}`,
            {
                waitUntil: 'networkidle0',
            }
        );
        const monitorName = await newPage.$eval(
            '#monitor0 > div.uptime-graph-header.clearfix > span.uptime-stat-name',
            el => el.textContent
        );
        expect(monitorName).to.be.equal(monitor.name);
    });
});
