process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
const HTTP_TEST_SERVER_URL: string = 'http://localhost:3010';
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request: $TSFixMe = chai.request.agent(app);

const testServer: $TSFixMe = chai.request(HTTP_TEST_SERVER_URL);

import { createUser } from './utils/userSignUp';

import incidentData from './data/incident';
import UserService from '../backend/services/userService';
import UserModel from '../backend/models/user';
import ProjectService from '../backend/services/projectService';
import ProjectModel from '../backend/models/project';
import IncidentService from '../backend/services/incidentService';
import MonitorService from '../backend/services/monitorService';
import NotificationService from '../backend/services/notificationService';
import IntegrationService from '../backend/services/integrationService';
import EmailStatusService from '../backend/services/emailStatusService';
import AirtableService from '../backend/services/airtableService';
import Config from './utils/config';
import VerificationTokenModel from '../backend/models/verificationToken';
import AlertModel from '../backend/models/alert';
import GlobalConfig from './utils/globalConfig';
import ComponentModel from '../backend/models/component';
import moment from 'moment';
import SubscriberService from '../backend/services/subscriberService';
import AlertVia from '../backend/config/alertType';
import {
    markIncidentAsResolved,
    markIncidentAsAcknowledged,
    markSubprojectIncidentAsAcknowledged,
    markSubprojectIncidentAsResolved,
} from './utils/test-utils';
const selectEmailStatus: $TSFixMe =
    'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

const sleep: Function = (waitTimeInMs: $TSFixMe): void =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let token: $TSFixMe,
    userId: ObjectID,
    projectId: ObjectID,
    monitorId: $TSFixMe,
    incidentId: $TSFixMe,
    testServerMonitorId,
    testServerIncidentId: $TSFixMe,
    componentId: $TSFixMe,
    investigationMessageId: $TSFixMe,
    internalMessageId: $TSFixMe;
const monitor: $TSFixMe = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};
const testServerMonitor: $TSFixMe = {
    name: 'Test Server',
    type: 'url',
    data: { url: HTTP_TEST_SERVER_URL },
};

describe('Incident API', function (): void {
    this.timeout(500000);

    before(async function (): void {
        this.timeout(90000);
        await GlobalConfig.initTestConfig();
        const res: $TSFixMe = await createUser(request, userData.user);
        projectId = res.body.project._id;
        userId = res.body.id;

        const verificationToken: $TSFixMe = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const res1: $TSFixMe = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });

        token = res1.body.tokens.jwtAccessToken;
        const authorization: string = `Basic ${token}`;
        const component: $TSFixMe = await ComponentModel.create({
            name: 'New Component',
            projectId,
        });
        componentId = component._id;
        const res2: $TSFixMe = await request
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
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
        await IntegrationService.hardDeleteBy({
            monitorId,
        });
        await IncidentService.hardDeleteBy({ projectId: projectId });
    });

    it('should create an incident', async (): void => {
        const authorization: string = `Basic ${token}`;
        const test1: $TSFixMe = await chai

            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/msteams');
        expect(test1).to.have.status(404);
        const test2: $TSFixMe = await chai

            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/slack');
        expect(test2).to.have.status(404);

        // no external subscriber's webhook notification shall be sent when there's no incident
        const webhookTest: $TSFixMe = await chai

            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/external_subscriber');
        expect(webhookTest).to.have.status(404);

        incidentData.monitors = [monitorId];
        const res: $TSFixMe = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        incidentId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');

        const msTeamsEndpoint: $TSFixMe = await chai

            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/msteams');
        expect(msTeamsEndpoint).to.have.status(200);

        const slackEndpoint: $TSFixMe = await chai

            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/slack');
        expect(slackEndpoint).to.have.status(200);

        // a webhook notification shall be received after an incident
        const webhookTestAfterIncident: $TSFixMe = await chai

            .request('http://127.0.0.1:3010')
            .get('/api/webhooks/external_subscriber');
        expect(webhookTestAfterIncident).to.have.status(200);
    });

    it('should create an incident with multi-probes and add to incident timeline', async (): void => {
        const authorization: string = `Basic ${token}`;
        await testServer.post('/api/settings').send({
            responseTime: 0,
            statusCode: 400,
            responseType: 'html',
            body: '<h1>Test Server</h1>',
        });

        const res: $TSFixMe = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({ ...testServerMonitor, componentId });
        testServerMonitorId = res.body._id;
        await sleep(300000);
        const res1: $TSFixMe = await request
            .post(`/incident/${projectId}/monitor/${testServerMonitorId}`)
            .set('Authorization', authorization);

        testServerIncidentId = res1.body.data[0]._id;
        const res2: $TSFixMe = await request
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

    it('should auto-resolve an incident with multi-probes and add to incident timeline', async (): void => {
        const authorization: string = `Basic ${token}`;
        await testServer.post('/api/settings').send({
            responseTime: 0,
            statusCode: 200,
            responseType: 'html',
            body: '<h1>Test Server</h1>',
        });

        await sleep(300000);
        const res: $TSFixMe = await request
            .get(`/incident/${projectId}/incident/${testServerIncidentId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body._id).to.be.equal(testServerIncidentId);
        expect(res.body.acknowledged).to.be.equal(true);
        expect(res.body.resolved).to.be.equal(true);
        const res1: $TSFixMe = await request
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

    it('should get incidents belonging to a monitor', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/incident/${projectId}/monitor/${monitorId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
    });

    it('should get all incidents in a project', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/incident/${projectId}/incident`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
    });

    it('should get an incident by incidentId', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/incident/${projectId}/incident/${incidentId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body._id).to.be.equal(incidentId);
    });

    it('should acknowledge an incident and send email to users', async (): void => {
        const date: $TSFixMe = moment().subtract(1, 'minutes');
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await markIncidentAsAcknowledged({
            request,
            authorization,
            projectId,
            incidentId,
        });
        const emailStatus: $TSFixMe = await EmailStatusService.findBy({
            query: {
                template: 'incident_acknowledged',
                createdAt: { $gt: date },
            },
            select: selectEmailStatus,
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.acknowledged).to.be.equal(true);
        expect(emailStatus.length).to.be.greaterThan(0);
    });

    it('should resolve an incident and send email to users', async (): void => {
        const date: $TSFixMe = moment().subtract(1, 'minutes');
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        const emailStatus: $TSFixMe = await EmailStatusService.findBy({
            query: { template: 'incident_resolved', createdAt: { $gt: date } },
            select: selectEmailStatus,
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.resolved).to.be.equal(true);
        expect(emailStatus.length).to.be.greaterThan(0);
    });

    it('should update incident details.', async (): void => {
        const authorization: string = `Basic ${token}`;
        const incidentTitle: string = 'New incident title';
        const incidentDescription: string = 'New incident description';

        const res: $TSFixMe = await request
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

    it('should get incident timeline by incidentId', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/incident/${projectId}/timeline/${incidentId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        // check if sorted by ascending order of createdAt
        expect(
            res.body.data.sort(
                (
                    firstIncidentTimeline: $TSFixMe,
                    secondIncidentTimeline: $TSFixMe
                ) =>
                    Date.parse(firstIncidentTimeline.createdAt) >
                    Date.parse(secondIncidentTimeline.createdAt)
            )
        ).to.equal(res.body.data);
    });

    it('should require an incident state', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send({
                content: 'Update the notes',
                type: 'test',
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Incident State is required.');
    });

    it('should require a valid incident message type', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should add an investigation incident message', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should add an internal incident message', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should update an investigation incident message', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should update an internal incident message', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should fetch list of investigation incident messages', async (): void => {
        const authorization: string = `Basic ${token}`;
        const type: string = 'investigation';
        const res: $TSFixMe = await request
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

    it('should fetch list of status pages for the incident', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/incident/${projectId}/${incidentId}/statuspages`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
    });

    it('should fetch list of internal incident messages', async (): void => {
        const authorization: string = `Basic ${token}`;
        const type: string = 'internal';
        const res: $TSFixMe = await request
            .get(
                `/incident/${projectId}/incident/${incidentId}/message?type=${type}`
            )
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.count).to.be.equal(1);

        const sameType = res.body.data.filter((e: $TSFixMe): void => {
            return e.type === 'internal';
        });
        expect(sameType[0].type).to.be.equal(type);
    });

    it('should not send incident alert when balance is below minimum amount (and stripeCustomerId is not valid)', async (): void => {
        const authorization: string = `Basic ${token}`;
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
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
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
        const schedule: $TSFixMe = await request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'test schedule',
            });
        const selectMonitor: $TSFixMe = await request
            .put(`/schedule/${projectId}/${schedule.body._id}`)
            .set('Authorization', authorization)
            .send({
                monitorIds: [monitorId],
            });
        expect(selectMonitor).to.have.status(200);
        const createEscalation: $TSFixMe = await request
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
        incidentData.monitors = [monitorId];
        const createdIncident: $TSFixMe = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(createdIncident).to.have.status(200);

        await sleep(10000);
        const smsAlert: $TSFixMe = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'sms',
        });

        const callAlert: $TSFixMe = await AlertModel.findOne({
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

    it('should not create an alert charge when an alert is not sent to a user.', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/alert/${projectId}/alert/charges`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.be.equal(0);
    });

    it('should send incident alert when balance is above minimum amount', async (): void => {
        const authorization: string = `Basic ${token}`;
        await ProjectModel.findByIdAndUpdate(projectId, {
            $set: {
                balance: 100,
            },
        });
        await IncidentService.hardDeleteBy({ projectId: projectId });
        incidentData.monitors = [monitorId];
        const createdIncident: $TSFixMe = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        await sleep(10000);
        const smsAlert: $TSFixMe = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'sms',
        });
        expect(smsAlert).to.be.an('object');
        expect(smsAlert.alertStatus).to.be.equal('Success');
        const callAlert: $TSFixMe = await AlertModel.findOne({
            incidentId: createdIncident.body._id,
            alertVia: 'call',
        });
        expect(callAlert).to.be.an('object');
        expect(callAlert.alertStatus).to.be.equal('Success');
        expect(callAlert.error).to.be.equal(false);
    });

    it('should create an alert charge when an alert is sent to a user.', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/alert/${projectId}/alert/charges`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.be.equal(2);
    });
});

let subProjectId: ObjectID,
    newUserToken: $TSFixMe,
    subProjectIncidentId: $TSFixMe;

describe('Incident API with Sub-Projects', function (): void {
    this.timeout(60000);

    before(async function (): void {
        this.timeout(60000);

        incidentData.monitors = [monitorId];
        incidentData.projectId = projectId;

        const authorization: string = `Basic ${token}`;
        // create a subproject for parent project
        await GlobalConfig.initTestConfig();
        const res: $TSFixMe = await request
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' });
        subProjectId = res.body[0]._id;
        // sign up second user (subproject user)
        const res1: $TSFixMe = await createUser(request, userData.newUser);
        userId = res1.body.id;
        const verificationToken: $TSFixMe = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const res2: $TSFixMe = await request.post('/user/login').send({
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

    after(async (): void => {
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

    it('should not create an incident for user not present in project', async (): void => {
        const res: $TSFixMe = await createUser(request, userData.anotherUser);
        const verificationToken: $TSFixMe = await VerificationTokenModel.findOne({
            userId: res.body.id,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        const res1: $TSFixMe = await request.post('/user/login').send({
            email: userData.anotherUser.email,
            password: userData.anotherUser.password,
        });
        const authorization: string = `Basic ${res1.body.tokens.jwtAccessToken}`;
        const res2: $TSFixMe = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(res2).to.have.status(400);
        expect(res2.body.message).to.be.equal(
            'You are not present in this project.'
        );
    });

    it('should create an incident in parent project.', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        incidentId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    it('should create an incident in sub-project.', async (): void => {
        const authorization: string = `Basic ${newUserToken}`;
        const res: $TSFixMe = await request
            .post(`/incident/${subProjectId}/create-incident`)
            .set('Authorization', authorization)
            .send({ ...incidentData, projectId: subProjectId });
        subProjectIncidentId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    it("should get only sub-project's incidents for valid sub-project user", async (): void => {
        const authorization: string = `Basic ${newUserToken}`;
        const res: $TSFixMe = await request
            .get(`/incident/${subProjectId}/incident`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.data.length).to.be.equal(1);
        expect(res.body.data[0]._id).to.be.equal(subProjectIncidentId);
    });

    it('should get both project and sub-project incidents for valid parent project user.', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/incident/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body[0]).to.have.property('incidents');
        expect(res.body[0]).to.have.property('count');
        expect(res.body[0]._id).to.be.equal(subProjectId);
        expect(res.body[1]._id).to.be.equal(projectId);
    });

    it('should acknowledge subproject incident', async (): void => {
        const authorization: string = `Basic ${newUserToken}`;
        const res: $TSFixMe = await markSubprojectIncidentAsAcknowledged({
            request,
            authorization,
            subProjectId,
            incidentId,
        });

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.incident.acknowledged).to.be.equal(true);
    });

    it('should resolve subproject incident', async (): void => {
        const authorization: string = `Basic ${newUserToken}`;
        const res: $TSFixMe = await markSubprojectIncidentAsResolved({
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
