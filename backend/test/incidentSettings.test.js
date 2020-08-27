/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const incidentData = require('./data/incident');
const UserService = require('../backend/services/userService');
const MonitorService = require('../backend/services/monitorService');
const IncidentService = require('../backend/services/incidentService');
const IncidentSettings = require('../backend/services/incidentSettingsService');
const ComponentService = require('../backend/services/componentService');
const ProjectService = require('../backend/services/projectService');
const NotificationService = require('../backend/services/notificationService');
const {
    incidentDefaultSettings,
} = require('../backend/config/incidentDefaultSettings');
const VerificationTokenModel = require('../backend/models/verificationToken');
const GlobalConfig = require('./utils/globalConfig');
const ComponentModel = require('../backend/models/component');

let token, userId, projectId, monitorId, componentId, incidentId;

const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

const incidentSettings = {
    title: `TEST: {{monitorName}}`,
    description: `TEST: {{incidentType}}`,
};
const incidentSettingsAfterSubstitution = {
    title: `TEST: ${monitor.name}`,
    description: `TEST: ${incidentData.incidentType}`,
};

describe('Incident Settings API', function() {
    this.timeout(500000);
    before(function(done) {
        this.timeout(90000);
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
                                        projectId,
                                    }).then(component => {
                                        componentId = component._id;
                                        request
                                            .post(`/monitor/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({ ...monitor, componentId })
                                            .end(async function(err, res) {
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
        await IncidentService.hardDeleteBy({ _id: incidentId });
        await IncidentSettings.hardDeleteBy({ projectId: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await ComponentService.hardDeleteBy({ _id: componentId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
    });

    it('should return the list of the available variables', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incidentSettings/variables`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body.length).to.be.greaterThan(0);
        expect(res.body[0]).to.be.an('object');
        expect(res.body[0]).to.have.property('name');
        expect(res.body[0]).to.have.property('definition');
    });

    it('should return the default settings if no custom settings are defined', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incidentSettings/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('title');
        expect(res.body).to.have.property('description');
        expect(res.body.title).to.eql(incidentDefaultSettings.title);
        expect(res.body.description).to.eql(
            incidentDefaultSettings.description
        );
    });

    it('should update the default incident settings.', async () => {
        const authorization = `Basic ${token}`;
        let res = await request
            .put(`/incidentSettings/${projectId}`)
            .set('Authorization', authorization)
            .send(incidentSettings);
        expect(res).to.have.status(200);
        res = await request
            .get(`/incidentSettings/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('title');
        expect(res.body).to.have.property('description');
        expect(res.body.title).to.eql(incidentSettings.title);
        expect(res.body.description).to.eql(incidentSettings.description);
    });

    it('should substitute variables with their values when an incident is created.', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        incidentId = res.body._id;
        const incident = await IncidentService.findOneBy({ _id: incidentId });
        expect(incident.title).to.eql(incidentSettingsAfterSubstitution.title);
        expect(incident.description).to.eql(
            incidentSettingsAfterSubstitution.description
        );
    });
});
