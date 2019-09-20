process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var ScheduledEventService = require('../backend/services/scheduledEventService');
var ScheduledEventModel = require('../backend/models/scheduledEvent');
var MonitorService = require('../backend/services/monitorService');
var VerificationTokenModel = require('../backend/models/verificationToken');

var token, userId, token_, projectId, scheduleEventId, apiKey, monitorId, authorization, scheduledEvent = {
        name: 'New scheduled Event',
        startDate: '2019-06-11 11:01:52.178',
        endDate: '2019-06-26 11:31:53.302',
        description: 'New scheduled Event description ',
        showEventOnStatusPage: true,
        alertSubscriber: true,
        callScheduleOnEvent: true,
        monitorDuringEvent: false
    },
    monitor = {
        name: 'New Monitor',
        type: 'url',
        data: { url: 'http://www.tests.org' }
    },
    invisibleScheduledEvent = {
        name: 'New invisible scheduled Event',
        startDate: '2019-06-11 11:01:52.178',
        endDate: '2019-06-26 11:31:53.302',
        description: 'New invisible scheduled Event description',
        showEventOnStatusPage: true,
        alertSubscriber: false,
        callScheduleOnEvent: false,
        monitorDuringEvent: true
    };

describe('Scheduled event API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            let project = res.body.project;
            userId = res.body.id;
            projectId = project._id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        var authorization = `Basic ${token}`;
                        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                            monitorId = res.body[0]._id;
                            done();
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ScheduledEventService.hardDeleteBy({ _id: scheduleEventId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
    });

    it('should reject the request of an unauthenticated user', function (done) {
        request.post(`/scheduledEvent/${projectId}/${monitorId}`).send(scheduledEvent).end(function (err, res) {
            expect(res).to.have.status(401);
            done();
        });
    });

    it('should not create a scheduled event when the fields are null', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).send({
            name: null,
            startDate: '',
            endDate: '',
            description: ''
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should create a new scheduled event when proper fields are given by an authenticated user', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).send(scheduledEvent).end(function (err, res) {
            scheduleEventId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal(scheduledEvent.name);
            done();
        });
    });

    it('should get all scheduled events for an authenticated user by projectId and monitorId', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.length.greaterThan(0);
            expect(res.body).to.have.property('count');
            expect(res.body.count).to.be.an('number');
            done();
        });
    });

    it('should update a scheduled event when scheduledEventId is valid', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', authorization).send({
            name: 'updated name'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal('updated name');
            done();
        });
    });

    it('should delete a scheduled event when scheduledEventId is valid', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });
});

describe('User from other project have access to read / write and delete API.', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            request.post('/user/signup').send(userData.newUser).end(function (err, res) {
                userId = res.body.id;
                VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                    request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                        request.post('/user/login').send({
                            email: userData.newUser.email,
                            password: userData.newUser.password
                        }).end(function (err, res) {
                            token = res.body.tokens.jwtAccessToken;
                            done();
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
    });

    it('should not be able to create new scheduled event', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).send(scheduledEvent).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to delete a scheduled event', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to get all scheduled events', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to update a scheduled event', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', authorization).send({
            name: 'updated name'
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
});

describe('Scheduled Event API - Check pagination for 12 scheduled events', function () {
    this.timeout(20000);

    var scheduledEvents = Array(12).fill({
        name: 'testPagination',
        description: 'testPaginationDescription',
        startDate: '2019-06-11 11:01:52.178',
        endDate: '2019-06-26 11:31:53.302',
    });


    before(async function () {
        this.timeout(30000);
        var signUp = await request.post('/user/signup').send(userData.user);
        let project = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;
        var verificationToken = await VerificationTokenModel.findOne({ userId });
        try{
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch(error){
            //catch
        }
        var login = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });
        token = login.body.tokens.jwtAccessToken;
        var authorization = `Basic ${token}`;

        var createdScheduledEvents = scheduledEvents.map(async scheduledEvent => {
            var sentRequests = await request.post(`/scheduledEvent/${projectId}/${monitorId}`)
                .set('Authorization', authorization)
                .send(scheduledEvent);
            return sentRequests;
        });

        await Promise.all(createdScheduledEvents);
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ScheduledEventModel.deleteMany({ name: 'testPagination' });
    });

    it('should get first 10 scheduled events with data length 10, skip 0, limit 10 and count 12', async function () {
        var authorization = `Basic ${token}`;
        var res = await request.get(`/scheduledEvent/${projectId}/${monitorId}?skip=0&limit=10`).set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data).to.have.length(10);
        expect(res.body).to.have.property('count');
        expect(res.body.count).to.be.an('number').to.be.equal(12);
        expect(res.body).to.have.property('skip');
        expect(parseInt(res.body.skip)).to.be.an('number').to.be.equal(0);
        expect(res.body).to.have.property('limit');
        expect(parseInt(res.body.limit)).to.be.an('number').to.be.equal(10);

    });

    it('should get 2 last scheduled events with data length 2, skip 10, limit 10 and count 12', async function () {
        var authorization = `Basic ${token}`;
        var res = await request.get(`/scheduledEvent/${projectId}/${monitorId}?skip=10&limit=10`).set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data).to.have.length(2);
        expect(res.body).to.have.property('count');
        expect(res.body.count).to.be.an('number').to.be.equal(12);
        expect(res.body).to.have.property('skip');
        expect(parseInt(res.body.skip)).to.be.an('number').to.be.equal(10);
        expect(res.body).to.have.property('limit');
        expect(parseInt(res.body.limit)).to.be.an('number').to.be.equal(10);
    });

    it('should get 0 scheduled events with data length 0, skip 20, limit 10 and count 12', async function () {
        var authorization = `Basic ${token}`;
        var res = await request.get(`/scheduledEvent/${projectId}/${monitorId}?skip=20&limit=10`).set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data).to.have.length(0);
        expect(res.body).to.have.property('count');
        expect(res.body.count).to.be.an('number').to.be.equal(12);
        expect(res.body).to.have.property('skip');
        expect(parseInt(res.body.skip)).to.be.an('number').to.be.equal(20);
        expect(res.body).to.have.property('limit');
        expect(parseInt(res.body.limit)).to.be.an('number').to.be.equal(10);
    });
});


describe('Non-admin user access to create, delete and access scheduled events.', function () {
    this.timeout(20000);

    var projectIdSecondUser = '';
    var emailToBeInvited = '';

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user)
            .end(function (err, res) {
                let project = res.body.project;
                projectId = project._id;
                userId = res.body.id;
                VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                    request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                        request.post('/user/login').send({
                            email: userData.user.email,
                            password: userData.user.password
                        }).end(function (err, res) {
                            token = res.body.tokens.jwtAccessToken;
                            var authorization = `Basic ${token}`;
                            request.post(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).send(scheduledEvent)
                                .end(function (err, res) {
                                    scheduleEventId = res.body._id;
                                    request.post('/user/signup').send(userData.newUser)
                                        .end(function (err, res) {
                                            projectIdSecondUser = res.body.project._id;
                                            emailToBeInvited = userData.newUser.email;
                                            userId = res.body.id;
                                            request.post(`/team/${projectId}`).set('Authorization', authorization).send({
                                                emails: emailToBeInvited,
                                                role: 'Member'
                                            }).end(function () {
                                                VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                                                    request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                                                        request.post('/user/login').send({
                                                            email: userData.newUser.email,
                                                            password: userData.newUser.password
                                                        }).end(function (err, res) {
                                                            token = res.body.tokens.jwtAccessToken;
                                                            done();
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                });
                        });
                    });
                });
            });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await ProjectService.hardDeleteBy({ _id: projectIdSecondUser });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ScheduledEventService.hardDeleteBy({ _id: scheduleEventId });
    });

    it('should not be able to create a new scheduled event', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).send(scheduledEvent).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to delete a scheduled event', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to update a scheduled event', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', authorization).send({
            name: 'updated name'
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should be able to get all scheduled events', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/scheduledEvent/${projectId}/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.length.greaterThan(0);
            expect(res.body).to.have.property('count');
            expect(res.body.count).to.be.an('number');
            done();
        });
    });
});

describe('Scheduled events APIs accesible through API key', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            apiKey = project.apiKey;
            done();
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ScheduledEventService.hardDeleteBy({ _id: scheduleEventId });
    });

    it('should create a new scheduled event when proper `name` field is given by an authenticated user', function (done) {
        request.post(`/scheduledEvent/${projectId}/${monitorId}`).set('apiKey', apiKey).send(scheduledEvent).end(function (err, res) {
            scheduleEventId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal(scheduledEvent.name);
            done();
        });
    });

    it('should get all scheduled events for an authenticated user by projectId and monitorId', function (done) {
        request.get(`/scheduledEvent/${projectId}/${monitorId}`).set('apiKey', apiKey).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.length.greaterThan(0);
            expect(res.body).to.have.property('count');
            expect(res.body.count).to.be.an('number');
            done();
        });
    });

    it('should update a scheduled event when scheduledEventId is valid', function (done) {
        request.put(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('apiKey', apiKey).send({
            name: 'updated name'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal('updated name');
            done();
        });
    });

    it('should delete a scheduled event when scheduledEventId is valid', function (done) {
        request.delete(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('apiKey', apiKey).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });

});
describe('Scheduled events APIs for status page', function () {
    this.timeout(20000);

    before(async function () {
        this.timeout(30000);
        var signUpRequest = await request.post('/user/signup').send(userData.user);
        projectId = signUpRequest.body.project._id;
        userId = signUpRequest.body.id;

        var verificationToken = await VerificationTokenModel.findOne({ userId });
        try{
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch(error){
            //catch
        }

        var loginRequest = await request.post('/user/login')
            .send({ email: userData.user.email, password: userData.user.password });
        token = loginRequest.body.tokens.jwtAccessToken;


        signUpRequest = await request.post('/user/signup').send(userData.newUser);
        userId = signUpRequest.body.id;
        verificationToken = await VerificationTokenModel.findOne({ userId });
        try{
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch(error){
            //catch
        }

        loginRequest = await request.post('/user/login')
            .send({ email: userData.newUser.email, password: userData.newUser.password });
        token_ = loginRequest.body.tokens.jwtAccessToken;

        authorization = `Basic ${token}`;

        var monitorRequest = await request.post(`/monitor/${projectId}`)
            .set('Authorization', authorization).send(monitor);
        monitorId = monitorRequest.body[0]._id;

        await request.post(`/scheduledEvent/${projectId}/${monitorId}`)
            .set('Authorization', authorization).send(scheduledEvent);
        var scheduleEventRequest = await request.post(`/scheduledEvent/${projectId}/${monitorId}`)
            .set('Authorization', authorization).send(invisibleScheduledEvent);
        scheduleEventId = scheduleEventRequest.body._id;
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ScheduledEventService.hardDeleteBy({ _id: scheduleEventId });
        await ScheduledEventService.hardDeleteBy({ name: scheduledEvent.name });
        await MonitorService.hardDeleteBy({ _id: monitorId });
    });

    it('should get a scheduled event for status page for public status page', function (done) {
        request.get(`/scheduledEvent/${projectId}/${monitorId}/statusPage`).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.lengthOf(2);
            expect(res.body).to.have.property('count');
            expect(res.body.count).to.be.an('number');
            done();
        });
    });

    it('should get a scheduled event for private status page', function (done) {
        request.get(`/scheduledEvent/${projectId}/${monitorId}/statusPage`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.lengthOf(2);
            expect(res.body).to.have.property('count');
            expect(res.body.count).to.be.an('number');
            done();
        });
    });
    it('should not get scheduled event for users of other project', function (done) {
        request.get(`/scheduledEvent/${projectId}/${monitorId}/statusPage`).set('Authorization', `Basic ${token_}`).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should get only one visible scheduled event', function (done) {
        request.put(`/scheduledEvent/${projectId}/${scheduleEventId}`).set('Authorization', `Basic ${token}`).send({
            showEventOnStatusPage: false,
            alertSubscriber: true,
            callScheduleOnEvent: true,
            monitorDuringEvent: false
        }).end(function () {
            request.get(`/scheduledEvent/${projectId}/${monitorId}/statusPage`).set('Authorization', `Basic ${token}`).end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.lengthOf(1);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.an('number');
                done();
            });
        });
    });
});
