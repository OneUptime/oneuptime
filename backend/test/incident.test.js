/* eslint-disable no-undef */

process.env.PORT = 3020;
const HTTP_TEST_SERVER_URL = 'http://localhost:3010';
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const testServer = chai.request(HTTP_TEST_SERVER_URL);
const { createUser } = require('./utils/userSignUp');

const incidentData = require('./data/incident');
const UserService = require('../backend/services/userService');
const UserModel = require('../backend/models/user');
const ProjectService = require('../backend/services/projectService');
const ProjectModel = require('../backend/models/project');
const IncidentService = require('../backend/services/incidentService');
const MonitorService = require('../backend/services/monitorService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');
const Config = require('./utils/config');
const VerificationTokenModel = require('../backend/models/verificationToken');
const AlertModel = require('../backend/models/alert');
const GlobalConfig = require('./utils/globalConfig');
const ComponentModel = require('../backend/models/component');
const sleep = waitTimeInMs =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let token,
    userId,
    airtableId,
    projectId,
    monitorId,
    incidentId,
    testServerMonitorId,
    testServerIncidentId,
    componentId;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};
const testServerMonitor = {
    name: 'Test Server',
    type: 'url',
    data: { url: HTTP_TEST_SERVER_URL },
};

describe('Incident API', function() {
    this.timeout(500000);
    before(function(done) {
        this.timeout(60000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                projectId = res.body.project._id;
                userId = res.body.id;
                airtableId = res.body.airtableId;

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
                                    const authorization = `Basic ${token}`;
                                    ComponentModel.create({
                                        name: 'New Component',
                                    }).then(component => {
                                        componentId = component._id;
                                        request
                                            .post(`/monitor/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({ ...monitor, componentId })
                                            .end(function(err, res) {
                                                monitorId = res.body._id;
                                                expect(res).to.have.status(200);
                                                expect(
                                                    res.body.name
                                                ).to.be.equal(monitor.name);
                                                done();
                                            });
                                    });
                                });
                        });
                });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should create an incident', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end(function(err, res) {
                incidentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should create an incident with multi-probes and add to incident timeline', function(done) {
        const authorization = `Basic ${token}`;
        testServer
            .post('/api/settings')
            .send({
                responseTime: 0,
                statusCode: 400,
                responseType: 'html',
                body: '<h1>Test Server</h1>',
            })
            .end(() => {
                request
                    .post(`/monitor/${projectId}`)
                    .set('Authorization', authorization)
                    .send({ ...testServerMonitor, componentId })
                    .end(async function(err, res) {
                        testServerMonitorId = res.body._id;
                        await sleep(300000);
                        request
                            .post(
                                `/incident/${projectId}/monitor/${testServerMonitorId}`
                            )
                            .set('Authorization', authorization)
                            .end(function(err, res) {
                                testServerIncidentId = res.body.data[0]._id;
                                request
                                    .get(
                                        `/incident/${projectId}/timeline/${testServerIncidentId}`
                                    )
                                    .set('Authorization', authorization)
                                    .end(function(err, res) {
                                        expect(res).to.have.status(200);
                                        expect(res.body).to.be.an('object');
                                        expect(res.body).to.have.property(
                                            'data'
                                        );
                                        expect(res.body.data).to.be.an('array');
                                        expect(
                                            res.body.data.length
                                        ).to.be.equal(2);
                                        expect(
                                            res.body.data[0].status
                                        ).to.be.equal('offline');
                                        expect(
                                            res.body.data[1].status
                                        ).to.be.equal('offline');
                                        done();
                                    });
                            });
                    });
            });
    });

    it('should auto-resolve an incident with multi-probes and add to incident timeline', function(done) {
        const authorization = `Basic ${token}`;
        testServer
            .post('/api/settings')
            .send({
                responseTime: 0,
                statusCode: 200,
                responseType: 'html',
                body: '<h1>Test Server</h1>',
            })
            .end(async () => {
                await sleep(300000);
                request
                    .get(
                        `/incident/${projectId}/incident/${testServerIncidentId}`
                    )
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body._id).to.be.equal(testServerIncidentId);
                        expect(res.body.acknowledged).to.be.equal(true);
                        expect(res.body.resolved).to.be.equal(true);
                        request
                            .get(
                                `/incident/${projectId}/timeline/${testServerIncidentId}`
                            )
                            .set('Authorization', authorization)
                            .end(function(err, res) {
                                expect(res).to.have.status(200);
                                expect(res.body).to.be.an('object');
                                expect(res.body).to.have.property('data');
                                expect(res.body.data).to.be.an('array');
                                expect(res.body.data.length).to.be.equal(6);
                                expect(res.body.data[0].status).to.be.equal(
                                    'offline'
                                );
                                expect(res.body.data[1].status).to.be.equal(
                                    'offline'
                                );
                                expect(res.body.data[2].status).to.be.equal(
                                    'online'
                                );
                                expect(res.body.data[3].status).to.be.equal(
                                    'online'
                                );
                                expect(res.body.data[4].status).to.be.equal(
                                    'acknowledged'
                                );
                                expect(res.body.data[5].status).to.be.equal(
                                    'resolved'
                                );
                                done();
                            });
                    });
            });
    });

    it('should get incidents belonging to a monitor', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/monitor/${monitorId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get all incidents in a project', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/incident/${projectId}/incident`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get an incident by incidentId', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/incident/${projectId}/incident/${incidentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body._id).to.be.equal(incidentId);
                done();
            });
    });

    it('should acknowledge an incident', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/acknowledge/${incidentId}`)
            .set('Authorization', authorization)
            .send({})
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.acknowledged).to.be.equal(true);
                done();
            });
    });

    it('should resolve an incident', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/resolve/${incidentId}`)
            .set('Authorization', authorization)
            .send({})
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.resolved).to.be.equal(true);
                done();
            });
    });

    it('should get incident timeline by incidentId', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/incident/${projectId}/timeline/${incidentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should update the internal and investigation notes of an incident', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/incident/${projectId}/incident/${incidentId}`)
            .set('Authorization', authorization)
            .send({
                internalNote: 'Update the internal notes',
                investigationNote: 'Update the investigation notes',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body._id).to.be.equal(incidentId);
                done();
            });
    });

    it('should not send incident alert when balance is below minimum amount', async function() {
        const authorization = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                alertEnable: true,
                alertOptions: {
                    minimumBalance: 50,
                    rechargeToBalance: 100,
                    billingUS: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: false,
                },
            },
        });
        await sleep(10000);
        await UserModel.findByIdAndUpdate(userId, {
            $set: {
                alertPhoneNumber: Config.testphoneNumber,
            },
        });
        const schedule = await request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'test schedule',
            });
        const selectMonitor = await request
            .put(`/schedule/${projectId}/${schedule.body._id}`)
            .set('Authorization', authorization)
            .send({
                monitorIds: [monitorId],
            });
        let alert = null;
        if (selectMonitor) {
            const createEscalation = await request
                .post(
                    `/schedule/${projectId}/${schedule.body._id}/addescalation`
                )
                .set('Authorization', authorization)
                .send([
                    {
                        emailReminders: 10,
                        callReminders: 10,
                        smsReminders: 10,
                        call: true,
                        sms: true,
                        email: true,
                        teams: [
                            {
                                teamMembers: [
                                    {
                                        userId: userId,
                                    },
                                ],
                            },
                        ],
                    },
                ]);
            if (createEscalation) {
                const createdIncident = await request
                    .post(`/incident/${projectId}/${monitorId}`)
                    .set('Authorization', authorization)
                    .send(incidentData);
                alert = await AlertModel.findOne({
                    incidentId: createdIncident.body._id,
                    alertVia: 'sms',
                });
            }
        }
        expect(alert).to.be.an('object');
        expect(alert.alertStatus).to.be.equal('Blocked - Low balance');
    });

    it('should not create an alert charge when an alert is not sent to a user.', async function() {
        request.get(`alert/${projectId}/alert/charges`, function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data.length).to.be.equal(0);
        });
    });
    it('should send incident alert when balance is above minimum amount', async function() {
        const authorization = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                balance: 100,
            },
        });
        const createdIncident = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        await sleep(10000);
        const alert = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
        });
        expect(alert).to.be.an('object');
        expect(alert.alertStatus).to.be.equal('Success');
    });
    it('should create an alert charge when an alert is sent to a user.', async function() {
        request.get(`alert/${projectId}/alert/charges`, function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data.length).to.be.equal(1);
        });
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId, newUserToken, subProjectIncidentId;

describe('Incident API with Sub-Projects', function() {
    this.timeout(60000);
    before(function(done) {
        this.timeout(60000);
        const authorization = `Basic ${token}`;
        // create a subproject for parent project
        GlobalConfig.initTestConfig().then(function() {
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end(function(err, res) {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(request, userData.newUser, function(err, res) {
                        userId = res.body.id;
                        VerificationTokenModel.findOne({ userId }, function(
                            err,
                            verificationToken
                        ) {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end(function() {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.newUser.email,
                                            password: userData.newUser.password,
                                        })
                                        .end(function(err, res) {
                                            newUserToken =
                                                res.body.tokens.jwtAccessToken;
                                            const authorization = `Basic ${token}`;
                                            // add second user to subproject
                                            request
                                                .post(`/team/${subProjectId}`)
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send({
                                                    emails:
                                                        userData.newUser.email,
                                                    role: 'Member',
                                                })
                                                .end(function() {
                                                    done();
                                                });
                                        });
                                });
                        });
                    });
                });
        });
    });

    after(async function() {
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, subProjectId] },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
    });

    it('should not create an incident for user not present in project', function(done) {
        createUser(request, userData.anotherUser, function(err, res) {
            VerificationTokenModel.findOne({ userId: res.body.id }, function(
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
                                email: userData.anotherUser.email,
                                password: userData.anotherUser.password,
                            })
                            .end(function(err, res) {
                                const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                request
                                    .post(`/incident/${projectId}/${monitorId}`)
                                    .set('Authorization', authorization)
                                    .send(incidentData)
                                    .end(function(err, res) {
                                        expect(res).to.have.status(400);
                                        expect(res.body.message).to.be.equal(
                                            'You are not present in this project.'
                                        );
                                        done();
                                    });
                            });
                    });
            });
        });
    });

    it('should create an incident in parent project.', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end(function(err, res) {
                incidentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should create an incident in sub-project.', function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/incident/${subProjectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end(function(err, res) {
                subProjectIncidentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it("should get only sub-project's incidents for valid sub-project user", function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/incident/${subProjectId}/incident`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(1);
                expect(res.body.data[0]._id).to.be.equal(subProjectIncidentId);
                done();
            });
    });

    it('should get both project and sub-project incidents for valid parent project user.', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/incident/${projectId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('incidents');
                expect(res.body[0]).to.have.property('count');
                expect(res.body[0]._id).to.be.equal(subProjectId);
                expect(res.body[1]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should acknowledge subproject incident', function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/incident/${subProjectId}/acknowledge/${incidentId}`)
            .set('Authorization', authorization)
            .send({})
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.acknowledged).to.be.equal(true);
                done();
            });
    });

    it('should resolve subproject incident', function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/incident/${subProjectId}/resolve/${incidentId}`)
            .set('Authorization', authorization)
            .send({})
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.resolved).to.be.equal(true);
                done();
            });
    });
});
