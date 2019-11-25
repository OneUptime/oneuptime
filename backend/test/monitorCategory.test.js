process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var MonitorCategoryService = require('../backend/services/monitorCategoryService');
var MonitorCategoryModel = require('../backend/models/monitorCategory');
var AirtableService = require('../backend/services/airtableService');

var VerificationTokenModel = require('../backend/models/verificationToken');

var token, userId, airtableId, projectId, monitorCategoryId, apiKey, monitorCategory = {
    monitorCategoryName: 'New Monitor Category',
};
var payment = require('../backend/config/payment');
var stripe = require('stripe')(payment.paymentPrivateKey);

describe('Monitor Category API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        done();
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await MonitorCategoryService.hardDeleteBy({ _id: monitorCategoryId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should reject the request of an unauthenticated user', function (done) {
        request.post(`/monitorCategory/${projectId}`).send({
            monitorCategoryName: 'unauthenticated user',
        }).end(function (err, res) {
            expect(res).to.have.status(401);
            done();
        });
    });

    it('should not create a monitor category when the `monitorCategoryName` field is null', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send({
            monitorCategoryName: null
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should create a new monitor Category when proper `monitorCategoryName` field is given by an authenticated user', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send(monitorCategory).end(function (err, res) {
            monitorCategoryId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal(monitorCategory.monitorCategoryName);
            done();
        });
    });

    it('should get all monitor Categories for an authenticated user by ProjectId', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/monitorCategory/${projectId}`).set('Authorization', authorization).end(function (err, res) {
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


    it('should delete a monitor category when monitorCategoryId is valid', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/monitorCategory/${projectId}/${monitorCategoryId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });
});


describe('User from other project have access to read / write and delete API.', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
            projectId = project._id;
            createUser(request, userData.newUser, function(err, res) {
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
        await MonitorCategoryService.hardDeleteBy({ _id: monitorCategoryId });
    });

    it('should not be able to create new monitor category', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send(monitorCategory).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to delete a monitor category', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/monitorCategory/${projectId}/${monitorCategoryId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to get all monitor categories', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/monitorCategory/${projectId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
});



describe('Non-admin user access to create, delete and access monitor category.', function () {
    this.timeout(60000);

    var projectIdSecondUser = '';
    var emailToBeInvited = '';

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
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
                        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send(monitorCategory)
                            .end(function (err, res) {
                                monitorCategoryId = res.body._id;
                                createUser(request, userData.newUser, function(err, res) {
                                    projectIdSecondUser = res.body.project._id;
                                    emailToBeInvited = userData.newUser.email;
                                    userId = res.body.id;
                                    VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                                        request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                                            request.post(`/team/${projectId}`).set('Authorization', authorization).send({
                                                emails: emailToBeInvited,
                                                role: 'Member'
                                            }).end(function () {
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
        await MonitorCategoryService.hardDeleteBy({ _id: monitorCategoryId });
    });

    it('should not be able to create new monitor category', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send(monitorCategory).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should not be able to delete a monitor category', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/monitorCategory/${projectId}/${monitorCategoryId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });
    it('should be able to get all monitor categories', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/monitorCategory/${projectId}`).set('Authorization', authorization).end(function (err, res) {
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



describe('Monitor Category APIs accesible through API key', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
            projectId = project._id;
            apiKey = project.apiKey;
            done();
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await MonitorCategoryService.hardDeleteBy({ _id: monitorCategoryId });
    });

    it('should create a new monitor Category when proper `monitorCategoryName` field is given by an authenticated user', function (done) {
        request.post(`/monitorCategory/${projectId}`).set('apiKey', apiKey).send(monitorCategory).end(function (err, res) {
            monitorCategoryId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal(monitorCategory.monitorCategoryName);
            done();
        });
    });

    it('should get all monitor Categories for an authenticated user by ProjectId', function (done) {
        request.get(`/monitorCategory/${projectId}`).set('apiKey', apiKey).end(function (err, res) {
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


    it('should delete a monitor category when monitorCategoryId is valid', function (done) {
        request.delete(`/monitorCategory/${projectId}/${monitorCategoryId}`).set('apiKey', apiKey).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });

});

describe('Monitor Category API - Check pagination for 12 monitor categories', function () {
    this.timeout(40000);

    var monitorCategories = [
        'testPagination1',
        'testPagination2',
        'testPagination3',
        'testPagination4',
        'testPagination5',
        'testPagination6',
        'testPagination7',
        'testPagination8',
        'testPagination9',
        'testPagination10',
        'testPagination11',
        'testPagination12',
    ];

    before(async function () {
        this.timeout(60000);
        var checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: userData.email,
            companyName: userData.companyName
        });
        var confirmedPaymentIntent = await stripe.paymentIntents.confirm(checkCardData.body.id);

        var signUp = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id
            },
            ...userData.user
        });

        let project = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;
        var verificationToken = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch (error) {
            //catch
        }
        var login = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });
        token = login.body.tokens.jwtAccessToken;

        var authorization = `Basic ${token}`;

        var createdMonitorCategories = monitorCategories.map(async monitorCategoryName => {
            var sentRequests = await request.post(`/monitorCategory/${projectId}`)
                .set('Authorization', authorization)
                .send({ monitorCategoryName });
            return sentRequests;
        });
        await Promise.all(createdMonitorCategories);
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await MonitorCategoryService.hardDeleteBy({ _id: monitorCategoryId });
        await MonitorCategoryModel.deleteMany({ name: 'testPagination' });
    });

    it('should get first 10 monitor categories with data length 10, skip 0, limit 10 and count 12', async function () {
        var authorization = `Basic ${token}`;
        var res = await request.get(`/monitorCategory/${projectId}?skip=0&limit=10`).set('Authorization', authorization);
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

    it('should get 2 last monitor categories with data length 2, skip 10, limit 10 and count 12', async function () {
        var authorization = `Basic ${token}`;
        var res = await request.get(`/monitorCategory/${projectId}?skip=10&limit=10`).set('Authorization', authorization);
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

    it('should get 0 monitor categories with data length 0, skip 20, limit 10 and count 12', async function () {
        var authorization = `Basic ${token}`;
        var res = await request.get(`/monitorCategory/${projectId}?skip=20&limit=10`).set('Authorization', authorization);
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

