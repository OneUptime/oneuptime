process.env.PORT = 3020;
process.env.REDIS_HOST = 'redis.default.svc.cluster.local';
process.env.REDIS_PORT = 6379;
var expect = require('chai').expect;
var userData = require('./data/user');
var projectData = require('./data/project');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var NotificationService = require('../backend/services/notificationService');
var AirtableService = require('../backend/services/airtableService');

var VerificationTokenModel = require('../backend/models/verificationToken');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');

var projectId, token, userId, airtableId;

describe('Notification API', function () {
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
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should create a new notification', (done) => {
        let authorization = `Basic ${token}`;
        request.post(`/notification/${projectId}`).set('Authorization', authorization).send({
            message: 'New Notification',
            icon: 'bell'
        }).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should get project notifications current user is present in', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/notification/${projectId}`)
            .set('Authorization', authorization).send().end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should not get project notifications current user is not present in', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/notification/${projectData.firstProject._id}`)
            .set('Authorization', authorization).send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should mark project notification as read', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/notification/${projectId}`).set('Authorization', authorization).send({
            message: 'New Notification',
            icon: 'bell'
        }).end(function (err, res) {
            let notificationId = res.body._id;
            request.put(`/notification/${projectId}/${notificationId}/read`)
                .set('Authorization', authorization).end(function (err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body._id).to.be.equal(notificationId);
                    done();
                });
        });
    });

    it('should mark all project notifications as read', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/notification/${projectId}`).set('Authorization', authorization).send({
            message: 'New Notification',
            icon: 'bell'
        }).end(function () {
            request.put(`/notification/${projectId}/readAll`)
                .set('Authorization', authorization).end(function (err, res) {
                    expect(res).to.have.status(200);
                    done();
                });
        });
    });

    it('should reject request if the notification param is invalid ', function (done) {
        request.put(`/notification/${projectId}/${projectData.fakeProject._id}/read`).send().end(function (err, res) {
            expect(res).to.have.status(401);
            done();
        });
    });

});