process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');

var incidentData = require('./data/incident');
var UserService = require('../backend/services/userService');
var UserModel = require('../backend/models/user');
var ProjectService = require('../backend/services/projectService');
var ProjectModel = require('../backend/models/project');
var IncidentService = require('../backend/services/incidentService');
var MonitorService = require('../backend/services/monitorService');
var NotificationService = require('../backend/services/notificationService');
var AirtableService = require('../backend/services/airtableService');

var VerificationTokenModel = require('../backend/models/verificationToken');
var AlertModel = require('../backend/models/alert');
var sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));
var TwilioConfig = require('../backend/config/twilio');


var token, userId, airtableId, projectId, monitorId, incidentId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

describe('Incident API', function () {
    this.timeout(120000);
    before(function (done) {
        this.timeout(60000);
        createUser(request, userData.user, function (err, res) {
            projectId = res.body.project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

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
                            expect(res).to.have.status(200);
                            expect(res.body[0].name).to.be.equal(monitor.name);
                            done();
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
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

    it('should not send incident alert when balance is below minimum amount', async function () {
        var authorization = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                alertEnable: true,
                alertOptions: {
                    minimumBalance: 50,
                    rechargeToBalance: 100,
                    billingUS: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: false
                }
            }
        });
        await sleep(5000);
        await UserModel.findByIdAndUpdate(userId, {
            $set: {
                alertPhoneNumber: TwilioConfig.testphoneNumber
            }
        });
        var schedule = await request.post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'test schedule'
            });
        var selectMonitor = await request.put(`/schedule/${projectId}/${schedule.body._id}`)
            .set('Authorization', authorization)
            .send({
                monitorIds: [monitorId]
            });
        if (selectMonitor) {
            var createEscalation = await request.post(`/schedule/${projectId}/${schedule.body._id}/addescalation`).set('Authorization', authorization)
                .send([{
                    callFrequency: 10,
                    rotationFrequency: 'week',
                    rotationInterval: 2,
                    call: true,
                    sms: true,
                    email: false,
                    team: [{
                        teamMember: [{
                            member: userId,
                            startTime: 'Tue Dec 17 2019 01:00:26 GMT+0000',
                            endTime: 'Tue Dec 17 2019 22:55:26 GMT+0000',
                            timezone: 'UTC(GMT +00:00)'
                        }]
                    }]
                }]);
            if (createEscalation) {
                var createdIncident = await request.post(`/incident/${projectId}/${monitorId}`)
                    .set('Authorization', authorization)
                    .send(incidentData);
                var alert = await AlertModel.findOne({
                    incidentId: createdIncident.body._id
                });
            }
        }
        expect(alert).to.be.an('object');
        expect(alert.alertStatus).to.be.equal('Blocked - Low balance');
    });

    it('should not create an alert charge when an alert is not sent to a user.', async function () {
        request.get(`alert/${projectId}/alert/charges`, function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data.length).to.be.equal(0);
        });
    });
    it('should send incident alert when balance is above minimum amount', async function () {
        var authorization = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                balance: 100
            }
        });
        var createdIncident = await request.post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        await sleep(10000);
        var alert = await AlertModel.findOne({
            incidentId: createdIncident.body._id
        });
        expect(alert).to.be.an('object');
        expect(alert.alertStatus).to.be.equal('success');
    });
    it('should create an alert charge when an alert is sent to a user.', async function () {
        request.get(`alert/${projectId}/alert/charges`, function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data.length).to.be.equal(1);
        });
    });
});

// eslint-disable-next-line no-unused-vars
var subProjectId, newUserToken, subProjectIncidentId;

describe('Incident API with Sub-Projects', function () {
    this.timeout(60000);
    before(function (done) {
        this.timeout(60000);
        var authorization = `Basic ${token}`;
        // create a subproject for parent project
        request.post(`/project/${projectId}/subProject`).set('Authorization', authorization).send({ subProjectName: 'New SubProject' }
        ).end(function (err, res) {
            subProjectId = res.body._id;
            // sign up second user (subproject user)
            createUser(request, userData.newUser, function (err, res) {
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
        createUser(request, userData.anotherUser, function (err, res) {
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
