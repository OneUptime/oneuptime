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
const IntegrationService = require('../backend/services/integrationService');
const EmailStatusService = require('../backend/services/emailStatusService');
const AirtableService = require('../backend/services/airtableService');
const Config = require('./utils/config');
const VerificationTokenModel = require('../backend/models/verificationToken');
const AlertModel = require('../backend/models/alert');
const GlobalConfig = require('./utils/globalConfig');
const ComponentModel = require('../backend/models/component');
const moment = require('moment');
const SubscriberService = require('../backend/services/subscriberService');
const AlertVia = require('../backend/config/alertType');
const {
    markIncidentAsResolved,
    markIncidentAsAcknowledged,
    markSubprojectIncidentAsAcknowledged,
    markSubprojectIncidentAsResolved,
} = require('./utils/test-utils');
const sleep = waitTimeInMs =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let token,
    userId,
    projectId,
    monitorId,
    incidentId,
    testServerMonitorId,
    testServerIncidentId,
    componentId,
    investigationMessageId,
    internalMessageId;
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
    before(async function() {
        this.timeout(90000);
        await GlobalConfig.initTestConfig();
        const res = await createUser(request, userData.user);
        projectId = res.body.project._id;
        userId = res.body.id;

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const res1 = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });

        token = res1.body.tokens.jwtAccessToken;
        const authorization = `Basic ${token}`;
        const component = await ComponentModel.create({
            name: 'New Component',
            projectId,
        });
        componentId = component._id;
        const res2 = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({ ...monitor, componentId });
        monitorId = res2.body._id;
        await IntegrationService.create(
            projectId,
            userId,
            {
                monitorId,
                userId,
                endpoint: 'http://127.0.0.1:3010/api/webhooks/msteams',
            },
            'msteams',
            {
                incidentCreated: true,
                incidentResolved: true,
                incidentAcknowledged: true,
            }
        );

        await IntegrationService.create(
            projectId,
            userId,
            {
                monitorId,
                userId,
                endpoint: 'http://127.0.0.1:3010/api/webhooks/slack',
            },
            'slack',
            {
                incidentCreated: true,
                incidentResolved: true,
                incidentAcknowledged: true,
            }
        );

        // create an external webhook subscriber
        await SubscriberService.create({
            projectId,
            monitorId,
            alertVia: AlertVia.Webhook,
            contactWebhook:
                'http://127.0.0.1:3010/api/webhooks/external_subscriber',
            webhookMethod: 'post',
        });

        expect(res2).to.have.status(200);
        expect(res2.body.name).to.be.equal(monitor.name);
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
        await IntegrationService.hardDeleteBy({
            monitorId,
        });
        await IncidentService.hardDeleteBy({ projectId: projectId });
    });

    it('should create an incident', async function() {
        const authorization = `Basic ${token}`;
        const test1 = await chai
            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/msteams');
        expect(test1).to.have.status(404);
        const test2 = await chai
            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/slack');
        expect(test2).to.have.status(404);

        // no external subscriber's webhook notification shall be sent when there's no incident
        const webhookTest = await chai
            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/external_subscriber');
        expect(webhookTest).to.have.status(404);

        const res = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        incidentId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');

        const msTeamsEndpoint = await chai
            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/msteams');
        expect(msTeamsEndpoint).to.have.status(200);

        const slackEndpoint = await chai
            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/slack');
        expect(slackEndpoint).to.have.status(200);

        // a webhook notification shall be received after an incident
        const webhookTestAfterIncident = await chai
            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/external_subscriber');
        expect(webhookTestAfterIncident).to.have.status(200);
    });

    it('should create an incident with multi-probes and add to incident timeline', async function() {
        const authorization = `Basic ${token}`;
        await testServer.post('/api/settings').send({
            responseTime: 0,
            statusCode: 400,
            responseType: 'html',
            body: '<h1>Test Server</h1>',
        });

        const res = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({ ...testServerMonitor, componentId });
        testServerMonitorId = res.body._id;
        await sleep(300000);
        const res1 = await request
            .post(`/incident/${projectId}/monitor/${testServerMonitorId}`)
            .set('Authorization', authorization);

        testServerIncidentId = res1.body.data[0]._id;
        const res2 = await request
            .get(`/incident/${projectId}/timeline/${testServerIncidentId}`)
            .set('Authorization', authorization);
        expect(res2).to.have.status(200);
        expect(res2.body).to.be.an('object');
        expect(res2.body).to.have.property('data');
        expect(res2.body.data).to.be.an('array');
        expect(res2.body.data.length).to.be.equal(2);
        expect(res2.body.data[0].status).to.be.equal('offline');
        expect(res2.body.data[1].status).to.be.equal('offline');
    });

    it('should auto-resolve an incident with multi-probes and add to incident timeline', async function() {
        const authorization = `Basic ${token}`;
        await testServer.post('/api/settings').send({
            responseTime: 0,
            statusCode: 200,
            responseType: 'html',
            body: '<h1>Test Server</h1>',
        });

        await sleep(300000);
        const res = await request
            .get(`/incident/${projectId}/incident/${testServerIncidentId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body._id).to.be.equal(testServerIncidentId);
        expect(res.body.acknowledged).to.be.equal(true);
        expect(res.body.resolved).to.be.equal(true);
        const res1 = await request
            .get(`/incident/${projectId}/timeline/${testServerIncidentId}`)
            .set('Authorization', authorization);

        expect(res1).to.have.status(200);
        expect(res1.body).to.be.an('object');
        expect(res1.body).to.have.property('data');
        expect(res1.body.data).to.be.an('array');
        expect(res1.body.data.length).to.be.equal(6);
        expect(res1.body.data[0].status).to.be.equal('offline');
        expect(res1.body.data[1].status).to.be.equal('offline');
        expect(res1.body.data[2].status).to.be.equal('online');
        expect(res1.body.data[3].status).to.be.equal('online');
        expect(res1.body.data[4].status).to.be.equal('acknowledged');
        expect(res1.body.data[5].status).to.be.equal('resolved');
    });

    it('should get incidents belonging to a monitor', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/monitor/${monitorId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
    });

    it('should get all incidents in a project', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incident/${projectId}/incident`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
    });

    it('should get an incident by incidentId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incident/${projectId}/incident/${incidentId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body._id).to.be.equal(incidentId);
    });

    it('should acknowledge an incident and send email to users', async function() {
        const authorization = `Basic ${token}`;
        const res = await markIncidentAsAcknowledged({
            request,
            authorization,
            projectId,
            incidentId,
        });
        const date = moment().subtract(1, 'minutes');
        const emailStatus = await EmailStatusService.findBy({
            template: 'incident_acknowledged',
            createdAt: { $gt: date },
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.acknowledged).to.be.equal(true);
        expect(emailStatus.length).to.be.greaterThan(0);
    });

    it('should resolve an incident and send email to users', async function() {
        const authorization = `Basic ${token}`;
        const res = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        const date = moment().subtract(1, 'minutes');
        const emailStatus = await EmailStatusService.findBy({
            template: 'incident_resolved',
            createdAt: { $gt: date },
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.resolved).to.be.equal(true);
        expect(emailStatus.length).to.be.greaterThan(0);
    });

    it('should update incident details.', async function() {
        const authorization = `Basic ${token}`;
        const incidentTitle = 'New incident title';
        const incidentDescription = 'New incident description';

        const res = await request
            .put(`/incident/${projectId}/incident/${incidentId}/details`)
            .set('Authorization', authorization)
            .send({
                title: incidentTitle,
                description: incidentDescription,
            });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.title).to.be.equal(incidentTitle);
        expect(res.body.description).to.be.equal(incidentDescription);
    });

    it('should get incident timeline by incidentId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incident/${projectId}/timeline/${incidentId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        // check if sorted by ascending order of createdAt
        expect(
            res.body.data.sort(
                (firstIncidentTimeline, secondIncidentTimeline) =>
                    Date.parse(firstIncidentTimeline.createdAt) >
                    Date.parse(secondIncidentTimeline.createdAt)
            )
        ).to.equal(res.body.data);
    });

    it('should require an incident state', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'Update the notes',
                type: 'test',
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Incident State is required.');
    });

    it('should require a valid incident message type', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'Update the notes',
                type: 'test',
                incident_state: 'investigation',
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Incident Message type is not of required types.'
        );
    });

    it('should add an investigation incident message', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'Update the notes',
                type: 'investigation',
                incident_state: 'investigation',
            });
        investigationMessageId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.incidentId._id).to.be.equal(incidentId);
        expect(res.body.type).to.be.equal('investigation');
        expect(res.body.incident_state).to.be.equal('investigation');
    });

    it('should add an internal incident message', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'Update the notes',
                type: 'internal',
                incident_state: 'just test',
            });
        internalMessageId = res.body.data[0]._id;
        expect(res).to.have.status(200);
        expect(res.body.data[0].incidentId._id.toString()).to.be.equal(
            incidentId
        );
        expect(res.body.type).to.be.equal('internal');
        expect(res.body.data[0].incident_state).to.be.equal('just test');
    });

    it('should update an investigation incident message', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'real set for the notes',
                id: investigationMessageId,
                incident_state: 'automated',
            });
        expect(res).to.have.status(200);
        expect(res.body._id).to.be.equal(investigationMessageId);
        expect(res.body.type).to.be.equal('investigation');
        expect(res.body.updated).to.be.equal(true);
        expect(res.body.content).to.be.equal('real set for the notes');
        expect(res.body.incident_state).to.be.equal('automated');
    });

    it('should update an internal incident message', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'update comes',
                id: internalMessageId,
                incident_state: 'update',
            });

        expect(res).to.have.status(200);
        expect(res.body._id).to.be.equal(internalMessageId);
        expect(res.body.type).to.be.equal('internal');
        expect(res.body.updated).to.be.equal(true);
        expect(res.body.content).to.be.equal('update comes');
        expect(res.body.incident_state).to.be.equal('update');
    });

    it('should fetch list of investigation incident messages', async function() {
        const authorization = `Basic ${token}`;
        const type = 'investigation';
        const res = await request
            .get(
                `/incident/${projectId}/incident/${incidentId}/message?type=${type}`
            )
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.count).to.be.equal(3); // messages created when incident is acknowledged and resolved
        expect(res.body.data[0].type).to.be.equal(type);
    });

    it('should fetch list of status pages for the incident', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incident/${projectId}/${incidentId}/statuspages`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
    });

    it('should fetch list of internal incident messages', async function() {
        const authorization = `Basic ${token}`;
        const type = 'internal';
        const res = await request
            .get(
                `/incident/${projectId}/incident/${incidentId}/message?type=${type}`
            )
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.count).to.be.equal(1);

        const sameType = res.body.data.filter(function(e) {
            return e.type === 'internal';
        });
        expect(sameType[0].type).to.be.equal(type);
    });

    it('should not send incident alert when balance is below minimum amount (and stripeCustomerId is not valid)', async function() {
        const authorization = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                alertEnable: true,
                alertOptions: {
                    minimumBalance: 0,
                    rechargeToBalance: 100,
                    billingUS: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: false,
                },
            },
        });
        const user = await UserService.findOneBy({ _id: userId });
        const stripeCustomerId = user.stripeCustomerId;
        await UserService.updateOneBy(
            {
                _id: userId,
            },
            {
                stripeCustomerId: 'wrong_customer_id',
            }
        );
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
        expect(selectMonitor).to.have.status(200);
        const createEscalation = await request
            .post(`/schedule/${projectId}/${schedule.body._id}/addescalation`)
            .set('Authorization', authorization)
            .send([
                {
                    emailReminders: 1,
                    callReminders: 1,
                    smsReminders: 1,
                    call: true,
                    sms: true,
                    email: true,
                    teams: [
                        {
                            teamMembers: [
                                {
                                    userId,
                                },
                            ],
                        },
                    ],
                },
            ]);
        expect(createEscalation).to.have.status(200);
        const createdIncident = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(createdIncident).to.have.status(200);

        await sleep(10000);
        const smsAlert = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'sms',
        });

        const callAlert = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'call',
        });
        expect(smsAlert).to.be.an('object');
        expect(smsAlert.alertStatus).to.equal(null);
        expect(smsAlert.error).to.equal(true);
        expect(smsAlert.errorMessage).to.equal('Low Balance');
        expect(callAlert).to.be.an('object');
        expect(callAlert.alertStatus).to.equal(null);
        expect(callAlert.error).to.equal(true);
        expect(callAlert.errorMessage).to.equal('Low Balance');

        await UserService.updateOneBy(
            {
                _id: userId,
            },
            {
                stripeCustomerId,
            }
        );
    });

    it('should not create an alert charge when an alert is not sent to a user.', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/alert/${projectId}/alert/charges`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.be.equal(0);
    });

    it('should send incident alert when balance is above minimum amount', async function() {
        const authorization = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                balance: 100,
            },
        });
        await IncidentService.hardDeleteBy({ projectId: projectId });
        const createdIncident = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        await sleep(10000);
        const smsAlert = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'sms',
        });
        expect(smsAlert).to.be.an('object');
        expect(smsAlert.alertStatus).to.be.equal('Success');
        const callAlert = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'call',
        });
        expect(callAlert).to.be.an('object');
        expect(callAlert.alertStatus).to.be.equal('Success');
        expect(callAlert.error).to.be.equal(false);
    });
    it('should create an alert charge when an alert is sent to a user.', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/alert/${projectId}/alert/charges`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.be.equal(2);
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId, newUserToken, subProjectIncidentId;

describe('Incident API with Sub-Projects', function() {
    this.timeout(60000);
    before(async function() {
        this.timeout(60000);
        const authorization = `Basic ${token}`;
        // create a subproject for parent project
        await GlobalConfig.initTestConfig();
        const res = await request
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' });
        subProjectId = res.body[0]._id;
        // sign up second user (subproject user)
        const res1 = await createUser(request, userData.newUser);
        userId = res1.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const res2 = await request.post('/user/login').send({
            email: userData.newUser.email,
            password: userData.newUser.password,
        });
        newUserToken = res2.body.tokens.jwtAccessToken;
        // add second user to subproject
        await request
            .post(`/team/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.newUser.email,
                role: 'Member',
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

    it('should not create an incident for user not present in project', async function() {
        const res = await createUser(request, userData.anotherUser);
        const verificationToken = await VerificationTokenModel.findOne({
            userId: res.body.id,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        const res1 = await request.post('/user/login').send({
            email: userData.anotherUser.email,
            password: userData.anotherUser.password,
        });
        const authorization = `Basic ${res1.body.tokens.jwtAccessToken}`;
        const res2 = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(res2).to.have.status(400);
        expect(res2.body.message).to.be.equal(
            'You are not present in this project.'
        );
    });

    it('should create an incident in parent project.', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        incidentId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    it('should create an incident in sub-project.', async function() {
        const authorization = `Basic ${newUserToken}`;
        const res = await request
            .post(`/incident/${subProjectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        subProjectIncidentId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    it("should get only sub-project's incidents for valid sub-project user", async function() {
        const authorization = `Basic ${newUserToken}`;
        const res = await request
            .get(`/incident/${subProjectId}/incident`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.data.length).to.be.equal(1);
        expect(res.body.data[0]._id).to.be.equal(subProjectIncidentId);
    });

    it('should get both project and sub-project incidents for valid parent project user.', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incident/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body[0]).to.have.property('incidents');
        expect(res.body[0]).to.have.property('count');
        expect(res.body[0]._id).to.be.equal(subProjectId);
        expect(res.body[1]._id).to.be.equal(projectId);
    });

    it('should acknowledge subproject incident', async function() {
        const authorization = `Basic ${newUserToken}`;
        const res = await markSubprojectIncidentAsAcknowledged({
            request,
            authorization,
            subProjectId,
            incidentId,
        });

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.acknowledged).to.be.equal(true);
    });

    it('should resolve subproject incident', async function() {
        const authorization = `Basic ${newUserToken}`;
        const res = await markSubprojectIncidentAsResolved({
            request,
            authorization,
            subProjectId,
            incidentId,
        });

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.resolved).to.be.equal(true);
    });
});
