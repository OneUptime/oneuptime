/* eslint-disable no-undef */

// Load env vars from the backend.
require('custom-env').env(null, '../backend');

const puppeteer = require('puppeteer');
const expect = require('chai').expect;
const chai = require('chai');
const moment = require('moment');
chai.use(require('chai-http'));

const app = 'http://localhost:3002';
const request = chai.request(app);

const ACCOUNTS_URL = 'http://localhost:3003/accounts';

let token,
    authorization,
    projectId,
    monitorCategoryId,
    monitorId,
    scheduledEventMonitorId,
    scheduledEventId,
    statusPageId,
    privateStatusPageId,
    userId,
    futureEventId,
    incidentId,
    monitorCategoryName,
    monitorName;
const testData = require('./data/data');
const VerificationTokenModel = require('../../../backend/backend/models/verificationToken');
const UserService = require('../../../backend/backend/services/userService');
const ScheduledEventService = require('../../../backend/backend/services/scheduledEventService');
const payment = require('../../../backend/backend/config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const monitor = testData.monitor;
const monitorCategory = testData.monitorCategory;
const scheduledEvent = testData.scheduledEvent;
const futureScheduledEvent = testData.futureScheduledEvent;
const statusPage = testData.statusPage;
const privateStatusPage = testData.privateStatusPage;
const degradeIncident = testData.degradeIncident;
const onlineIncident = testData.onlineIncident;
const scheduledEventNote = testData.scheduledEventNote;
const incidentNote = testData.incidentNote;
const componentName = testData.component;

let today = new Date().toISOString();
today = moment(today).format();
const tomorrow = moment(today)
    .add(2, 'days')
    .format();
const dateId = moment(today)
    .format('LL')
    .replace(/, | /g, '');

let browser, page, statusPageURL;
const monitorMessage = 'You have subscribed to this status page successfully';

describe('Status page monitors check', function() {
    this.timeout(240000);
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

          // component creation before monitor is created
          const componentRequest = await request
          .post(`/component/${projectId}`)
          .set('Authorization', authorization)
          .send(componentName);         

        const resourceCategoryRequest = await request
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorCategory);
        monitorCategoryId = resourceCategoryRequest.body._id;
        monitorCategoryName = resourceCategoryRequest.body.name;
        monitor.resourceCategory = monitorCategoryId;
        monitor.componentId = componentRequest.body._id;
      
        const monitorRequest = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);        
        monitorId = monitorRequest.body._id;
        monitorName = monitorRequest.body.name;
        scheduledEventMonitorId = monitorId;

        scheduledEvent.startDate = today;
        scheduledEvent.endDate = tomorrow;
        scheduledEvent.monitors = [monitorId];

        const scheduledEventRequest = await request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send(scheduledEvent);
        scheduledEventId = scheduledEventRequest.body._id;

        // scheduled event to happen in the future
        futureScheduledEvent.startDate = tomorrow;
        futureScheduledEvent.endDate = tomorrow;
        futureScheduledEvent.monitors = [monitorId];

        const futureEvent = await request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send(futureScheduledEvent);
        futureEventId = futureEvent._id;

        statusPage.projectId = projectId;
        statusPage.monitors = [
            {
                monitor: monitorId,
                description: 'Monitor description',
                uptime: true,
                memory: false,
                cpu: false,
                storage: false,
                responseTime: false,
                temperature: false,
                runtime: false,
            },
        ];

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

        // The tests were written with 'Classic Theme'
        await request
            .put(`/statusPage/${projectId}/theme`)
            .set('Authorization', authorization)
            .send({
                theme: 'Classic Theme',
                statusPageId: statusPageId
            })

        statusPageURL = `http://${statusPageId}.localhost:3006/`;

        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(statusPageURL, {
            waitUntil: 'networkidle0',
        });
    });

    it('Status page should have one monitor with a category', async function() {
        const monitorName = await page.$eval(
            '#monitor0 > div.uptime-graph-header  span.uptime-stat-name',
            el => el.textContent
        );
        expect(monitorName).to.be.equal(monitor.name);

        const noOfBlockCharts = await page.evaluate(() => {
            const monitors = document.getElementsByClassName('block-chart');
            return monitors.length;
        });
        expect(noOfBlockCharts).to.be.equal(1);

        const noOfLineCharts = await page.evaluate(() => {
            const monitors = document.getElementsByClassName(
                'recharts-responsive-container'
            );
            return monitors.length;
        });
        expect(noOfLineCharts).to.be.equal(0);
    });

    it('Status page add one more monitor and the monitor count should be 2', async function() {
        monitor.name = 'NewMonitorSecond';
        const monitorRequest = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        monitorId = monitorRequest.body._id;
        statusPage.monitors.push({
            monitor: monitorId,
            description: 'Monitor description',
            uptime: true,
            memory: false,
            cpu: false,
            storage: false,
            responseTime: true,
            temperature: false,
            runtime: false,
        });
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                monitors: statusPage.monitors,
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

        const noOfBlockCharts = await page.evaluate(() => {
            const monitors = document.getElementsByClassName('block-chart');
            return monitors.length;
        });
        expect(noOfBlockCharts).to.be.equal(2);

        const noOfLineCharts = await page.evaluate(() => {
            const monitors = document.getElementsByClassName(
                'recharts-responsive-container'
            );
            return monitors.length;
        });
        expect(noOfLineCharts).to.be.equal(1);
    });

    it('should be able to add monitor without monitor category and the count should be 3', async function() {
        monitor.name = 'NewMonitorWithoutMonitorCategory';
        delete monitor.resourceCategory;
        const monitorRequest = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        monitorId = monitorRequest.body._id;
        statusPage.monitors.push({
            monitor: monitorId,
            description: 'Monitor description',
            uptime: false,
            memory: false,
            cpu: false,
            storage: false,
            responseTime: true,
            temperature: false,
            runtime: false,
        });
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                monitors: statusPage.monitors,
            });
        await page.reload({
            waitUntil: 'networkidle0',
        });       

        const noOfMonitors = await page.evaluate(() => {
            const monitors = document.getElementsByClassName(
                'monitorLists'                
            );            
            return monitors.length;
        });        
         expect(noOfMonitors).to.be.equal(3);

        const noOfBlockCharts = await page.evaluate(() => {
            const monitors = document.getElementsByClassName('block-chart');
            return monitors.length;
        });
        expect(noOfBlockCharts).to.be.equal(2);

        const noOfLineCharts = await page.evaluate(() => {
            const monitors = document.getElementsByClassName(
                'recharts-responsive-container'
            );
            return monitors.length;
        });
        expect(noOfLineCharts).to.be.equal(2);
    });

    it('should be displayed category wise', async function() {
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                isGroupedByMonitorCategory: true,
            });
        await page.goto(statusPageURL, { waitUntil: 'networkidle0' });
        const monitorCategoryNameSelector = `#monitorCategory_${monitorName}`;
        await page.waitForSelector(monitorCategoryNameSelector);
        const monitorCategoryName = await page.$eval(
            `${monitorCategoryNameSelector} > span`,
            el => el.textContent
        );
        expect(monitorCategoryName).to.be.equal(
            monitorCategory.resourceCategoryName
        );
    });

    it('should display monitor category on status page', async function() {
        await page.goto(statusPageURL, { waitUntil: 'networkidle0' });
        const categoryId = `#monitorCategory_${monitorName}`;

        await page.waitForSelector(categoryId);
        const categoryName = await page.$eval(
            `${categoryId} > span`,
            elem => elem.textContent
        );
        expect(categoryName).to.be.equal(monitorCategoryName);
    });

    it('should display "UNCATEGORIZED" when the monitor category associated with monitor is deleted', async function() {
        await request
            .delete(`/resourceCategory/${projectId}/${monitorCategoryId}`)
            .set('Authorization', authorization);
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const monitorCategoryNameSelector = `#monitorCategory_${monitorName}`;
        const monitorCategoryName = await page.$eval(
            `${monitorCategoryNameSelector} > span`,
            el => el.textContent
        );
        expect(monitorCategoryName).to.be.equal('Uncategorized');
    });

    it('should show incident card, and show incident if there is any', async function() {
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const incidentCard = await page.waitForSelector('#incidentCard', {
            visible: true,
        });
        expect(incidentCard).to.exist;
    });

    it('should display scheduled events when enabled on status page', async function() {
        await page.reload({
            waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#scheduledEvents');

        await page.waitForSelector('li.scheduledEvent');
        const scheduledEvents = await page.$$('li.scheduledEvent');
        const countScheduledEvents = scheduledEvents.length;

        const scheduledEventName = await page.$eval(
            'li.scheduledEvent .feed-title',
            el => el.textContent
        );

        expect(countScheduledEvents).to.be.equal(1);
        expect(scheduledEventName).to.be.equal(`${futureScheduledEvent.name}`);
    });

    it('should display ongoing scheduled event on status page', async function() {
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.ongoing__schedulebox');
        const ongoingEvents = await page.$$('.ongoing__schedulebox');

        expect(ongoingEvents.length).to.be.equal(1);
    });

    it('should navigate to scheduled event page on status page', async function() {
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('#scheduledEvents');
        await page.waitForSelector('li.scheduledEvent');
        const events = await page.$$('li.scheduledEvent');
        await events[0].click();

        await page.waitForSelector('#scheduledEventPage');
        const backnavigation = await page.$eval(
            '#scheduledEventPage .sp__icon--back',
            elem => elem.textContent
        );
        expect(backnavigation).to.be.equal('Back to status page');
    });

    it('should show scheduled event notes on scheduled event page', async function() {
        await request
            .post(`/scheduledEvent/${projectId}/${futureEventId}/notes`)
            .set('Authorization', authorization)
            .send(scheduledEventNote);

        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.messages li.feed-item');
        const notes = await page.$$('.messages li.feed-item');
        expect(notes.length).to.be.equal(1);
    });

    it('should display monitor scheduled events when date is selected', async function() {
        await page.goto(statusPageURL, {
            waitUntil: 'networkidle0',
        });
        await page.reload({
            waitUntil: 'networkidle0',
        });
        const monitorDaySelector = `div#block${scheduledEventMonitorId}${dateId}`;

        await page.waitForSelector(monitorDaySelector);
        await page.$eval(monitorDaySelector, e => e.click());

        await page.waitForSelector('li.scheduledEvent', { visible: true });
        const scheduledEvents = await page.$$('li.scheduledEvent');
        const countScheduledEvents = scheduledEvents.length;

        const scheduledEventName = await page.$eval(
            '#eventTitle',
            el => el.textContent
        );

        expect(countScheduledEvents).to.be.equal(1);
        expect(scheduledEventName).to.be.equal(`${scheduledEvent.name}`);
    });

    it('should not display scheduled events when disabled on status page', async function() {
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                showScheduledEvents: false,
            });

        await page.reload({
            waitUntil: 'networkidle0',
        });

        const scheduledEvents = await page.$('#scheduledEvents');

        expect(scheduledEvents).to.be.equal(null);
    });

    it('should display incident on status page', async function() {
        // add an online incident
        const incident = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(onlineIncident);
        incidentId = incident.body._id;

        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.incidentlist');
        const incidentTitle = await page.$eval(
            '.incidentlist .message > .text > span:nth-child(1)',
            elem => elem.textContent
        );
        expect(incidentTitle).to.be.equal(onlineIncident.title);
    });

    it('should navigate to incident page on status page', async function() {
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.incidentlist');
        const incidents = await page.$$('.incidentlist');
        await incidents[0].click();

        await page.waitForSelector('#incident');
        const backnavigation = await page.$eval(
            '#footer .sp__icon--back',
            elem => elem.textContent
        );
        expect(backnavigation).to.be.equal('Back to status page');
    });

    it('should show incident notes on incident page', async function() {
        await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send(incidentNote);

        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('#incidentNotes li.feed-item');
        const notes = await page.$$('#incidentNotes li.feed-item');
        expect(notes.length).to.be.equal(1);
    });

    it('should display Some services are degraded', async function() {
        // add a degraded incident
        await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(degradeIncident);

        await page.goto(statusPageURL, {
            waitUntil: 'networkidle0',
        });
        await page.reload({
            waitUntil: 'networkidle0',
        });
        await page.waitForTimeout(3000);
        await page.waitForSelector('.largestatus > .status-paused');
        const textHeader = await page.$eval('.title', e => e.textContent);
        expect(textHeader).to.be.eql('Some services are degraded');
    });
});

let newBrowser, newPage, privateStatusPageURL;

describe('Private status page check', function() {
    this.timeout(30000);
    before(async function() {
        this.enableTimeouts(false);

        privateStatusPage.projectId = projectId;
        privateStatusPage.monitors = [
            {
                monitor: monitorId,
                description: 'Monitor description',
                uptime: true,
                memory: false,
                cpu: false,
                storage: false,
                responseTime: false,
                temperature: false,
                runtime: false,
            },
        ];

        const statusPageRequest = await request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send(privateStatusPage);
        privateStatusPageId = statusPageRequest.body._id;

        // The tests were written with 'Classic Theme'
        await request
            .put(`/statusPage/${projectId}/theme`)
            .set('Authorization', authorization)
            .send({
                theme: 'Classic Theme',
                statusPageId: privateStatusPageId
            })

        privateStatusPageURL = `http://${privateStatusPageId}.localhost:3006/`;

        newBrowser = await puppeteer.launch({ headless: true });
        newPage = await newBrowser.newPage();
    });

    it('it should successfully subscribe a user via email', async function() {
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                isSubscriberEnabled: true,
            });
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.bs-Button-subscribe');
        await page.click('.bs-Button-subscribe');
        await page.waitForSelector('input[name=email]');
        await page.type('input[name=email]', 'testing@gmail.com');
        await page.waitForSelector('#subscribe-btn-email');
        await page.click('#subscribe-btn-email');
        await page.waitForSelector('#monitor-subscribe-success-message');
        const response = await page.$eval(
            '#monitor-subscribe-success-message',
            elem => elem.textContent
        );
        expect(response).to.be.eql(monitorMessage);
    });

    it('it should successfully subscribe a user via phone sms', async function() {
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                isSubscriberEnabled: true,
            });
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.bs-Button-subscribe');
        await page.click('.bs-Button-subscribe');
        await page.waitForSelector('#updates-dropdown-sms-btn');
        await page.click('#updates-dropdown-sms-btn');
        await page.waitForSelector('input[name=phone_number]');
        await page.type('input[name=phone_number]', '0812348342');
        await page.waitForSelector('#subscribe-btn-sms');
        await page.click('#subscribe-btn-sms');
        await page.waitForSelector('#monitor-subscribe-success-message');
        const response = await page.$eval(
            '#monitor-subscribe-success-message',
            elem => elem.textContent
        );
        expect(response).to.be.eql(monitorMessage);
    });
    it('it should subscribe a user to webhook notification succesfully', async function() {
        await request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                isSubscriberEnabled: true,
            });
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.bs-Button-subscribe');
        await page.click('.bs-Button-subscribe');
        await page.waitForSelector('#updates-dropdown-webhook-btn');
        await page.click('#updates-dropdown-webhook-btn');
        await page.waitForSelector('input[name=endpoint]');
        await page.type('input[name=endpoint]', 'example.com');
        await page.waitForSelector('input[name=email]');
        await page.type('input[name=email]', 'testing@gmail.com');
        await page.waitForSelector('#subscribe-btn-webhook');
        await page.click('#subscribe-btn-webhook');
        await page.waitForSelector('#monitor-subscribe-success-message');
        const response = await page.$eval(
            '#monitor-subscribe-success-message',
            elem => elem.textContent
        );

        expect(response).to.be.eql(monitorMessage);
    });

    after(async function() {
        if (browser) {
            await browser.close();
        }
        if (newBrowser) {
            await newBrowser.close();
        }
        await ScheduledEventService.hardDeleteBy({ _id: scheduledEventId });
        await UserService.hardDeleteBy({ _id: userId });
    });

    it('should redirect to login for unauthorized user', async function() {
        await newPage.goto(privateStatusPageURL, {
            waitUntil: 'networkidle0',
        });
        expect(newPage.url()).to.be.equal(ACCOUNTS_URL + '/login');
    });

    it('should not login user with invalid details', async function() {
        await page.goto(privateStatusPageURL, {
            waitUntil: 'networkidle0',
        });

        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', 'wrongemail@hackerbay.io');
        await page.click('input[name=password]');
        await page.type('input[name=password]', 'wrongpassword');
        await Promise.all([
            page.click('button[type=submit]'),
            page.waitFor(5000),
        ]);

        expect(page.url()).to.be.equal(ACCOUNTS_URL + '/login');
    });

    it('should redirect and login user with valid details', async function() {
        await page.goto(privateStatusPageURL, {
            waitUntil: 'networkidle0',
        });

        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', testData.user.email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', testData.user.password);
        await Promise.all([
            page.click('button[type=submit]'),
            page.waitFor(10000),
        ]);

        const monitorName = await page.$eval(
            '#monitor0 > div.uptime-graph-header span.uptime-stat-name',
            el => el.textContent
        );
        expect(monitorName).to.be.equal(monitor.name);
    });

    it('should login and display monitor for user with valid `userId` and `accessToken`', async function() {
        await newPage.goto(
            `${privateStatusPageURL}?userId=${userId}&accessToken=${token}`,
            {
                waitUntil: 'networkidle0',
            }
        );
        const monitorName = await newPage.$eval(
            '#monitor0 > div.uptime-graph-header span.uptime-stat-name',
            el => el.textContent
        );
        expect(monitorName).to.be.equal(monitor.name);
    });
});
