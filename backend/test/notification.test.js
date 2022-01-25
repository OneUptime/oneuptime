process.env.PORT = 3002;
const expect = require('chai').expect;
const userData = require('./data/user');
const projectData = require('./data/project');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');
const GlobalConfig = require('./utils/globalConfig');
const VerificationTokenModel = require('../backend/models/verificationToken');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');

let projectId, token, userId;

describe('Notification API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    err,
                    verificationToken
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function() {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    done();
                                });
                        });
                });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await ProjectService.hardDeleteBy({});
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should create a new notification', done => {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should get project notifications current user is present in', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should not get project notifications current user is not present in', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/notification/${projectData.firstProject._id}`)
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should mark project notification as read', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end(function(err, res) {
                const notificationId = res.body._id;
                request
                    .put(`/notification/${projectId}/read`)
                    .set('Authorization', authorization)
                    .send({ notificationIds: [notificationId] })
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('array');
                        expect(res.body).to.include(notificationId);
                        done();
                    });
            });
    });

    it('should close a notification', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end(function(err, res) {
                const notificationId = res.body._id;
                request
                    .put(`/notification/${projectId}/${notificationId}/closed`)
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body._id).to.be.equal(notificationId);
                        done();
                    });
            });
    });

    it('should mark all project notifications as read', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end(function() {
                request
                    .put(`/notification/${projectId}/readAll`)
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        done();
                    });
            });
    });

    it('should reject request if the notification param is invalid ', function(done) {
        request
            .put(`/notification/${projectId}/read`)
            .send({ notificationIds: [projectData.fakeProject._id] })
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });
});
