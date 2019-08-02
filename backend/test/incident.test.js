process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);

var incidentData = require('./data/incident');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var IncidentService = require('../backend/services/incidentService');
var MonitorService = require('../backend/services/monitorService');
var NotificationService = require('../backend/services/notificationService');
var VerificationTokenModel = require('../backend/models/verificationToken');


var token, userId, projectId, monitorId, incidentId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

describe('Incident API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            projectId = res.body.project._id;
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        var authorization = `Basic ${token}`;
                        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                            monitorId = res.body._id;
                            expect(res).to.have.status(200);
                            expect(res.body.name).to.be.equal(monitor.name);
                            done();
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await NotificationService.hardDeleteBy({ projectId: projectId });
    });

    it('should create an incident', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/incident/${projectId}/${monitorId}`).set('Authorization', authorization).send(incidentData).end(function (err, res) {
            incidentId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should get incidents belonging to a monitor', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/incident/${projectId}/monitor/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get all incidents in a project', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/incident/${projectId}/incident`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get an incident by incidentId', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/incident/${projectId}/incident/${incidentId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body._id).to.be.equal(incidentId);
            done();
        });
    });


    it('should acknowledge an incident', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/incident/${projectId}/acknowledge/${incidentId}`).set('Authorization', authorization).send({
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body.acknowledged).to.be.equal(true);
            done();
        });
    });

    it('should resolve an incident', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/incident/${projectId}/resolve/${incidentId}`).set('Authorization', authorization).send({
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body.resolved).to.be.equal(true);
            done();
        });
    });

    it('should update the internal and investigation notes of an incident', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/incident/${projectId}/incident/${incidentId}`).set('Authorization', authorization).send({
            internalNote: 'Update the internal notes',
            investigationNote: 'Update the investigation notes'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body._id).to.be.equal(incidentId);
            done();
        });
    });
});

// eslint-disable-next-line no-unused-vars
var subProjectId, newUserToken, subProjectIncidentId;

describe('Incident API with Sub-Projects', function () {
    this.timeout(30000);
    before(function (done) {
        this.timeout(30000);
        var authorization = `Basic ${token}`;
        // create a subproject for parent project
        request.post(`/project/${projectId}/subProject`).set('Authorization', authorization).send([{ name: 'New SubProject' }]
        ).end(function (err, res) {
            subProjectId = res.body[0]._id;
            // sign up second user (subproject user)
            request.post('/user/signup').send(userData.newUser).end(function (err, res) {
                userId = res.body.id;
                VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                    request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                        request.post('/user/login').send({
                            email: userData.newUser.email,
                            password: userData.newUser.password
                        }).end(function (err, res) {
                            newUserToken = res.body.tokens.jwtAccessToken;
                            var authorization = `Basic ${token}`;
                            // add second user to subproject
                            request.post(`/team/${subProjectId}`).set('Authorization', authorization).send({
                                emails: userData.newUser.email,
                                role: 'Member'
                            }).end(function () {
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: { $in: [projectId, subProjectId] } });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
    });

    it('should not create an incident for user not present in project', function (done) {
        request.post('/user/signup').send(userData.anotherUser).end(function (err, res) {
            VerificationTokenModel.findOne({ userId: res.body.id }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.anotherUser.email,
                        password: userData.anotherUser.password
                    }).end(function (err, res) {
                        var authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                        request.post(`/incident/${projectId}/${monitorId}`).set('Authorization', authorization).send(incidentData).end(function (err, res) {
                            expect(res).to.have.status(400);
                            expect(res.body.message).to.be.equal('You are not present in this project.');
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should create an incident in parent project.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/incident/${projectId}/${monitorId}`).set('Authorization', authorization).send(incidentData).end(function (err, res) {
            incidentId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should create an incident in sub-project.', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.post(`/incident/${subProjectId}/${monitorId}`).set('Authorization', authorization).send(incidentData).end(function (err, res) {
            subProjectIncidentId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should get only sub-project\'s incidents for valid sub-project user', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.get(`/incident/${subProjectId}/incident`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            expect(res.body.data.length).to.be.equal(1);
            expect(res.body.data[0]._id).to.be.equal(subProjectIncidentId);
            done();
        });
    });

    it('should get both project and sub-project incidents for valid parent project user.', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/incident/${projectId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('array');
            expect(res.body[0]).to.have.property('incidents');
            expect(res.body[0]).to.have.property('count');
            expect(res.body[0]._id).to.be.equal(subProjectId);
            expect(res.body[1]._id).to.be.equal(projectId);
            done();
        });
    });

    it('should acknowledge subproject incident', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.post(`/incident/${subProjectId}/acknowledge/${incidentId}`).set('Authorization', authorization).send({
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body.acknowledged).to.be.equal(true);
            done();
        });
    });

    it('should resolve subproject incident', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.post(`/incident/${subProjectId}/resolve/${incidentId}`).set('Authorization', authorization).send({
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body.resolved).to.be.equal(true);
            done();
        });
    });

});
