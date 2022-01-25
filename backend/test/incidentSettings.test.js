process.env.PORT = 3002;
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
const IncidentPrioritiesService = require('../backend/services/incidentPrioritiesService');
const ComponentService = require('../backend/services/componentService');
const ProjectService = require('../backend/services/projectService');
const NotificationService = require('../backend/services/notificationService');
const {
    incidentDefaultSettings,
} = require('../backend/config/incidentDefaultSettings');
const VerificationTokenModel = require('../backend/models/verificationToken');
const GlobalConfig = require('./utils/globalConfig');
const ComponentModel = require('../backend/models/component');
const AirtableService = require('../backend/services/airtableService');

let token, userId, projectId, monitorId, componentId, incidentId, templateId;

const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

const incidentSettings = {
    title: `TEST: {{monitorName}}`,
    description: `TEST: {{incidentType}}`,
    name: 'Another update',
};

describe('Incident Settings API', function() {
    this.timeout(500000);
    before(function(done) {
        this.timeout(90000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                projectId = res.body.project._id;
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
        await IncidentSettings.hardDeleteBy({ projectId });
        await IncidentPrioritiesService.hardDeleteBy({ projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await ComponentService.hardDeleteBy({ _id: componentId });
        await NotificationService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
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
            .get(`/incidentSettings/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);
        templateId = res.body.data[0]._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body).to.have.property('limit');
        expect(res.body).to.have.property('skip');
        expect(res.body.data[0].title).to.eql(incidentDefaultSettings.title);
        expect(res.body.data[0].description).to.eql(
            incidentDefaultSettings.description
        );
    });

    it('should update the default incident settings.', async () => {
        const authorization = `Basic ${token}`;
        const incidentPriorityObject = await IncidentPrioritiesService.findOne({
            query: {
                projectId,
                name: 'High',
            },
            select:
                'projectId name color createdAt deletedAt deleted deletedById',
        });
        expect(incidentPriorityObject).to.not.equal(null);
        const { _id: incidentPriority } = incidentPriorityObject;
        const res = await request
            .put(`/incidentSettings/${projectId}/${templateId}`)
            .set('Authorization', authorization)
            .send({ ...incidentSettings, incidentPriority });
        expect(res).to.have.status(200);

        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('title');
        expect(res.body).to.have.property('incidentPriority');
        expect(res.body).to.have.property('description');
        expect(res.body).to.have.property('name');
        expect(res.body.title).to.eql(incidentSettings.title);
        expect(res.body.description).to.eql(incidentSettings.description);
        expect(res.body.name).to.eql(incidentSettings.name);
    });

    it('should substitute variables with their values when an incident is created manually.', async () => {
        const authorization = `Basic ${token}`;
        const payload = {
            ...incidentData,
            ...incidentSettings,
            monitors: [monitorId],
        };
        const res = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(payload);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        incidentId = res.body._id;
        const incident = await IncidentService.findOneBy({
            query: { _id: incidentId },
            select: 'description',
        });
        expect(incident.description).to.eql('TEST: online');
    });
});
