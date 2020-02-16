process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');

let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let MonitorService = require('../backend/services/monitorService');
let ZapierService = require('../backend/services/zapierService');
let AirtableService = require('../backend/services/airtableService');

let VerificationTokenModel = require('../backend/models/verificationToken');
let incidentData = require('./data/incident');

// eslint-disable-next-line
let token, projectId, apiKey, userId, airtableId, zapierId, monitorId, incidentId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

describe('Zapier API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            apiKey = project.apiKey;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        let authorization = `Basic ${token}`;
                        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                            monitorId = res.body._id;
                            let authorization = `Basic ${token}`;
                            request.post(`/incident/${projectId}/${monitorId}`).set('Authorization', authorization).send(incidentData).end(function () {
                                request.post(`/incident/${projectId}/${monitorId}`).set('Authorization', authorization).send(incidentData).end(function () {
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await ZapierService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
        delete require.cache[require.resolve('../server')];
        app.close();
    });

    it('should not subscribe to zapier when missing apiKey in query', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not subscribe to zapier when missing url as a parameter', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                type: 'created',
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not subscribe to zapier when missing type as a parameter', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                url: 'https://www.fyipe.com',
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should subscribe to zapier service', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                url: 'https://www.fyipe.com',
                type: 'created',
                input: { monitors: ['12345'] },
            }).end(function (err, res) {
                zapierId = res.body.id;
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail getting test and apiKey is missing in query', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/test?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting test and projectId is missing in query', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/test?apiKey=${apiKey}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    /* :TODO
    it('should get zapier test', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/test?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
    */

    it('should fail getting incidents and apiKey is missing in query', function (done) {
        request.get(`/zapier/incidents?projectId=${projectId}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting incidents and projectId is missing in query', function (done) {
        request.get(`/zapier/incidents?apiKey=${apiKey}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get zapier incidents', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incidents?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail getting resolved and apiKey is missing in query', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incident/resolved?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting resolved and projectId is missing in query', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incident/resolved?apiKey=${apiKey}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get zapier resolved', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incident/resolved?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail getting acknowledged and apiKey is missing in query', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incident/acknowledged?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting acknowledged and projectId is missing in query', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incident/acknowledged?apiKey=${apiKey}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get zapier acknowledged', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/zapier/incident/acknowledged?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should unsubscribe to zapier', function (done) {
        request.delete(`/zapier/unsubscribe/${zapierId}?apiKey=${apiKey}&&projectId=${projectId}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail to create incidents when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/createIncident?projectId=${projectId}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to create incidents when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/createIncident?apiKey=${apiKey}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should create incident', function (done) {
        request.post(`/zapier/incident/createIncident?apiKey=${apiKey}&projectId=${projectId}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                incidentId = res.body.incidents[0]._id;
                done();
            });
    });
    it('should fail to acknowledge an incident when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/acknowledgeIncident?projectId=${projectId}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to acknowledge an incident when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/acknowledgeIncident?apiKey=${apiKey}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should acknowledge an incident', function (done) {
        request.post(`/zapier/incident/acknowledgeIncident?apiKey=${apiKey}&projectId=${projectId}`).send({
            incidents: [incidentId]
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.be.an('object');
            expect(res.body).to.have.property('incidents');
            expect(res.body.incidents.length).to.be.equal(1);
            expect(res.body.incidents[0].acknowledged).to.be.equal(true);
            done();
        });
    });
    it('should fail to resolve an incident when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/resolveIncident?projectId=${projectId}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to resolve an incident when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/resolveIncident?apiKey=${apiKey}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should resolve an incident', function (done) {
        request.post(`/zapier/incident/resolveIncident?apiKey=${apiKey}&projectId=${projectId}`).send({
            incidents: [incidentId]
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.be.an('object');
            expect(res.body).to.have.property('incidents');
            expect(res.body.incidents.length).to.be.equal(1);
            expect(res.body.incidents[0].acknowledged).to.be.equal(true);
            done();
        });
    });
    it('should fail to acknowledge last incidents when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/acknowledgeLastIncident?projectId=${projectId}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to acknowledge last incidents when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/acknowledgeLastIncident?apiKey=${apiKey}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should acknowledge last incident', function (done) {
        request.post(`/zapier/incident/acknowledgeLastIncident?apiKey=${apiKey}&projectId=${projectId}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });
    it('should fail to resolve last incidents when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/resolveLastIncident?projectId=${projectId}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to resolve last incidents when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/resolveLastIncident?apiKey=${apiKey}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should resolve last incident', function (done) {
        request.post(`/zapier/incident/resolveLastIncident?apiKey=${apiKey}&projectId=${projectId}`)
            .send({
                monitors: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });
    it('should fail to acknowledge all incidents when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/acknowledgeAllIncidents?projectId=${projectId}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to acknowledge all incidents when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/acknowledgeAllIncidents?apiKey=${apiKey}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should acknowledge all incident', function (done) {
        request.post(`/zapier/incident/acknowledgeAllIncidents?apiKey=${apiKey}&projectId=${projectId}`).send({
            monitors: [monitorId]
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('incidents');
            expect(res.body.incidents.length).to.be.equal(1);
            expect(res.body.incidents[0].acknowledged).to.be.equal(true);
            done();
        });
    });
    it('should fail to resolve all incidents when apiKey is missing in query', function (done) {
        request.post(`/zapier/incident/resolveAllIncidents?projectId=${projectId}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to resolve all incidents when projectId is missing in query', function (done) {
        request.post(`/zapier/incident/resolveAllIncidents?apiKey=${apiKey}`)
            .send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should resolve all incident', function (done) {
        request.post(`/zapier/incident/resolveAllIncidents?apiKey=${apiKey}&projectId=${projectId}`).send({
            monitors: [monitorId]
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('incidents');
            expect(res.body.incidents.length).to.be.equal(1);
            expect(res.body.incidents[0].acknowledged).to.be.equal(true);
            done();
        });
    });
});