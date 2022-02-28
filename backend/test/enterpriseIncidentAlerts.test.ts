process.env.PORT = 3020;
import userData from './data/user';
import chai from 'chai';
const expect = require('chai').expect;
import chaihttp from 'chai-http';
chai.use(chaihttp);
import chaiSubset from 'chai-subset';
chai.use(chaiSubset);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createEnterpriseUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ComponentService from '../backend/services/componentService';
import MonitorService from '../backend/services/monitorService';
import NotificationService from '../backend/services/notificationService';
import OnCallScheduleStatusService from '../backend/services/onCallScheduleStatusService';
import SubscriberService from '../backend/services/subscriberService';
import SubscriberAlertService from '../backend/services/subscriberAlertService';
import ScheduleService from '../backend/services/scheduleService';
import EscalationService from '../backend/services/escalationService';
import MonitorStatusModel from '../backend/models/monitorStatus';
import IncidentService from '../backend/services/incidentService';
import IncidentSMSActionModel from '../backend/models/incidentSMSAction';
import IncidentPriorityModel from '../backend/models/incidentPriority';
import IncidentMessageModel from '../backend/models/incidentMessage';
import IncidentTimelineModel from '../backend/models/incidentTimeline';
import AlertService from '../backend/services/alertService';
import AlertChargeModel from '../backend/models/alertCharge';
import TwilioModel from '../backend/models/twilio';
import VerificationToken from '../backend/models/verificationToken';
import LoginIPLog from '../backend/models/loginIPLog';

import UserModel from '../backend/models/user';
import GlobalConfigModel from '../backend/models/globalConfig';

const sleep = (waitTimeInMs: $TSFixMe) =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let authorization: $TSFixMe,
    token,
    userId: $TSFixMe,
    projectId: $TSFixMe,
    componentId,
    monitorId: $TSFixMe,
    scheduleId;

describe('Incident Alerts', function() {
    this.timeout(30000);

    before(function(done: $TSFixMe) {
        this.timeout(30000);
        GlobalConfig.initTestConfig().then(() => {
            createEnterpriseUser(request, userData.user, async function(
                err: $TSFixMe,
                res: $TSFixMe
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                await UserModel.updateOne(
                    { _id: userId },
                    { alertPhoneNumber: '+19173976235' }
                );
                request
                    .post('/user/login')
                    .send({
                        email: userData.user.email,
                        password: userData.user.password,
                    })
                    .end(async function(err: $TSFixMe, res: $TSFixMe) {
                        token = res.body.tokens.jwtAccessToken;
                        authorization = `Basic ${token}`;

                        const component = await request
                            .post(`/component/${projectId}`)
                            .set('Authorization', authorization)
                            .send({
                                projectId,
                                name: 'test',
                                criteria: {},
                                data: {},
                            });
                        componentId = component.body._id;

                        const monitor = await request
                            .post(`/monitor/${projectId}`)
                            .set('Authorization', authorization)
                            .send({
                                componentId,
                                projectId,
                                type: 'ip',
                                name: 'test monitor ',
                                data: { IPAddress: '216.58.223.196' }, // www.google.com
                                // deviceId: "abcdef", IOT device has been replaced with IP
                                criteria: {},
                            });
                        monitorId = monitor.body._id;

                        await request
                            .post(
                                `/subscriber/${projectId}/subscribe/${monitorId}`
                            )
                            .set('Authorization', authorization)
                            .send({
                                alertVia: 'sms',
                                contactPhone: '9173976235',
                                countryCode: 'us',
                            });

                        const schedule = await request
                            .post(`/schedule/${projectId}`)
                            .set('Authorization', authorization)
                            .send({ name: 'test schedule' });
                        scheduleId = schedule.body._id;

                        await request
                            .put(`/schedule/${projectId}/${scheduleId}`)
                            .set('Authorization', authorization)
                            .send({ monitorIds: [monitorId] });

                        await request
                            .post(
                                `/schedule/${projectId}/${scheduleId}/addescalation`
                            )
                            .set('Authorization', authorization)
                            .send([
                                {
                                    callReminders: '3',
                                    smsReminders: '3',
                                    emailReminders: '3',
                                    pushReminders: '3',
                                    email: false,
                                    sms: true,
                                    call: true,
                                    push: false,
                                    teams: [
                                        {
                                            teamMembers: [
                                                {
                                                    member: '',
                                                    timezone: '',
                                                    startTime: '',
                                                    endTime: '',
                                                    userId,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ]);
                        done();
                    });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await OnCallScheduleStatusService.hardDeleteBy({ project: projectId });
        await SubscriberService.hardDeleteBy({ projectId });
        await SubscriberAlertService.hardDeleteBy({ projectId });
        await ScheduleService.hardDeleteBy({ projectId });
        await EscalationService.hardDeleteBy({ projectId });
        await IncidentService.hardDeleteBy({ projectId });
        await AlertService.hardDeleteBy({ projectId });
        await MonitorStatusModel.deleteMany({ monitorId });
        await IncidentSMSActionModel.deleteMany({ userId });
        await IncidentPriorityModel.deleteMany({ projectId });
        await AlertChargeModel.deleteMany({ projectId });
        await TwilioModel.deleteMany({ projectId });
        await IncidentMessageModel.deleteMany({ createdById: userId });
        await IncidentTimelineModel.deleteMany({ createdById: userId });
        await VerificationToken.deleteMany({ userId });
        await LoginIPLog.deleteMany({ userId });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
    });

    describe('Global twilio credentials set (and Custom twilio settings not set)', async () => {
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings (SMS/Call) enable : true
         */

        it('should send SMS/Call alerts to on-call teams and subscribers if the SMS/Call alerts are enabled globally.', async function() {
            const globalSettings = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value } = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const incidentCreationEndpointResponse = await request
                .post(`/incident/${projectId}/create-incident`)
                .set('Authorization', authorization)
                .send({
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                });
            expect(incidentCreationEndpointResponse).to.have.status(200);
            const { _id: incidentId } = incidentCreationEndpointResponse.body;
            const incidentResolveEndpointResponse = await request
                .post(`/incident/${projectId}/resolve/${incidentId}`)
                .set('Authorization', authorization);
            expect(incidentResolveEndpointResponse).to.have.status(200);
            await sleep(10 * 1000);
            // slug is what is been used to query subscriber and onCall
            // The slug is gotten from the schema of the database
            const slug = incidentResolveEndpointResponse.body.incident.slug;
            const subscribersAlertsEndpointReponse = await request
                .get(
                    `/subscriberAlert/${projectId}/incident/${slug}?skip=0&limit=999`
                )
                .set('Authorization', authorization);
            expect(subscribersAlertsEndpointReponse).to.have.status(200);
            expect(subscribersAlertsEndpointReponse.body).to.an('object');
            expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
            expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
            expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(
                2
            );
            const eventTypesSent = [];
            for (const event of subscribersAlertsEndpointReponse.body.data) {
                const {
                    alertStatus,
                    alertVia,
                    eventType,
                    error,
                    errorMessage,
                } = event;
                eventTypesSent.push(eventType);
                expect(alertStatus).to.equal('Success');
                expect(alertVia).to.equal('sms');
                expect(error).to.equal(false);
                expect(errorMessage).to.equal(undefined);
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);
            const oncallAlertsEndpointReponse = await request
                .get(`/alert/${projectId}/incident/${slug}?skip=0&limit=999`)
                .set('Authorization', authorization);
            expect(oncallAlertsEndpointReponse).to.have.status(200);
            expect(oncallAlertsEndpointReponse.body).to.an('object');
            expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
            expect(oncallAlertsEndpointReponse.body.data).to.an('array');
            expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
            const alertsSentList = [];
            for (const event of oncallAlertsEndpointReponse.body.data) {
                const { alertVia, alertStatus, error } = event;
                expect(alertStatus).to.equal('Success');
                expect(error).to.equal(false);
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
        });
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : false
         */

        it('should not send Call alerts to on-call teams if the Call alerts are disabled in the global twilio configurations.', async function() {
            const globalSettings = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value } = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = false;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const incidentCreationEndpointResponse = await request
                .post(`/incident/${projectId}/create-incident`)
                .set('Authorization', authorization)
                .send({
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                });
            expect(incidentCreationEndpointResponse).to.have.status(200);
            const { _id: incidentId } = incidentCreationEndpointResponse.body;
            const incidentResolveEndpointResponse = await request
                .post(`/incident/${projectId}/resolve/${incidentId}`)
                .set('Authorization', authorization);
            expect(incidentResolveEndpointResponse).to.have.status(200);
            await sleep(10 * 1000);
            // slug is what is been used to query subscriber and onCall
            // The slug is gotten from the schema of the database
            const slug = incidentResolveEndpointResponse.body.incident.slug;
            const subscribersAlertsEndpointReponse = await request
                .get(
                    `/subscriberAlert/${projectId}/incident/${slug}?skip=0&limit=999`
                )
                .set('Authorization', authorization);
            expect(subscribersAlertsEndpointReponse).to.have.status(200);
            expect(subscribersAlertsEndpointReponse.body).to.an('object');
            expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
            expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
            expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(
                2
            );
            const eventTypesSent = [];
            for (const event of subscribersAlertsEndpointReponse.body.data) {
                const {
                    alertStatus,
                    alertVia,
                    eventType,
                    error,
                    errorMessage,
                } = event;
                eventTypesSent.push(eventType);
                expect(alertStatus).to.equal('Success');
                expect(alertVia).to.equal('sms');
                expect(error).to.equal(false);
                expect(errorMessage).to.equal(undefined);
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);
            const oncallAlertsEndpointReponse = await request
                .get(`/alert/${projectId}/incident/${slug}?skip=0&limit=999`)
                .set('Authorization', authorization);
            expect(oncallAlertsEndpointReponse).to.have.status(200);
            expect(oncallAlertsEndpointReponse.body).to.an('object');
            expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
            expect(oncallAlertsEndpointReponse.body.data).to.an('array');
            expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
            const alertsSentList = [];
            for (const event of oncallAlertsEndpointReponse.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
                if (alertVia === 'sms') {
                    expect(alertStatus).to.equal('Success');
                    expect(error).to.equal(false);
                } else if (alertVia === 'call') {
                    expect(alertStatus).to.equal(null);
                    expect(error).to.equal(true);
                    expect(errorMessage).to.equal(
                        'Alert Disabled on Admin Dashboard'
                    );
                }
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
        });
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : false
         * Global twilio settings Call enable : true
         */

        it('should not send SMS alerts to on-call teams and subscriber if the SMS alerts are disabled in the global twilio configurations.', async function() {
            const globalSettings = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value } = globalSettings;
            value['sms-enabled'] = false;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const incidentCreationEndpointResponse = await request
                .post(`/incident/${projectId}/create-incident`)
                .set('Authorization', authorization)
                .send({
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                });
            expect(incidentCreationEndpointResponse).to.have.status(200);
            const { _id: incidentId } = incidentCreationEndpointResponse.body;
            const incidentResolveEndpointResponse = await request
                .post(`/incident/${projectId}/resolve/${incidentId}`)
                .set('Authorization', authorization);
            expect(incidentResolveEndpointResponse).to.have.status(200);
            await sleep(10 * 1000);
            // slug is what is been used to query subscriber and onCall
            // The slug is gotten from the schema of the database
            const slug = incidentResolveEndpointResponse.body.incident.slug;
            const subscribersAlertsEndpointReponse = await request
                .get(
                    `/subscriberAlert/${projectId}/incident/${slug}?skip=0&limit=999`
                )
                .set('Authorization', authorization);
            expect(subscribersAlertsEndpointReponse).to.have.status(200);
            expect(subscribersAlertsEndpointReponse.body).to.an('object');
            expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
            expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
            expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(
                2
            );
            const eventTypesSent = [];
            for (const event of subscribersAlertsEndpointReponse.body.data) {
                const {
                    alertStatus,
                    alertVia,
                    eventType,
                    error,
                    errorMessage,
                } = event;
                eventTypesSent.push(eventType);
                expect(alertStatus).to.equal(null);
                expect(alertVia).to.equal('sms');
                expect(error).to.equal(true);
                expect(errorMessage).to.equal(
                    'Alert Disabled on Admin Dashboard'
                );
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);
            const oncallAlertsEndpointReponse = await request
                .get(`/alert/${projectId}/incident/${slug}?skip=0&limit=999`)
                .set('Authorization', authorization);
            expect(oncallAlertsEndpointReponse).to.have.status(200);
            expect(oncallAlertsEndpointReponse.body).to.an('object');
            expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
            expect(oncallAlertsEndpointReponse.body.data).to.an('array');
            expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
            const alertsSentList = [];
            for (const event of oncallAlertsEndpointReponse.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
                if (alertVia === 'call') {
                    expect(alertStatus).to.equal('Success');
                    expect(error).to.equal(false);
                } else if (alertVia === 'sms') {
                    expect(alertStatus).to.equal(null);
                    expect(error).to.equal(true);
                    expect(errorMessage).to.equal(
                        'Alert Disabled on Admin Dashboard'
                    );
                }
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
        });
    });

    describe('Custom twilio settings are set', async () => {
        /**
         * Global twilio settings: set
         * Custom twilio settings: set
         * Global twilio settings SMS enable : false
         * Global twilio settings Call enable : false
         */

        it('should send SMS/Call alerts to on-call teams and subscriber even if the alerts are disabled in the global twilio settings.', async function() {
            const globalSettings = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value } = globalSettings;
            value['sms-enabled'] = false;
            value['call-enabled'] = false;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const customTwilioSettingResponse = await request
                .post(`/smsSmtp/${projectId}`)
                .set('Authorization', authorization)
                .send({
                    accountSid: 'AC4b957669470069d68cd5a09d7f91d7c6',
                    authToken: '79a35156d9967f0f6d8cc0761ef7d48d',
                    enabled: true,
                    phoneNumber: '+15005550006',
                });
            expect(customTwilioSettingResponse).to.have.status(200);

            const incidentCreationEndpointResponse = await request
                .post(`/incident/${projectId}/create-incident`)
                .set('Authorization', authorization)
                .send({
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                });
            expect(incidentCreationEndpointResponse).to.have.status(200);

            const { _id: incidentId } = incidentCreationEndpointResponse.body;

            const incidentResolveEndpointResponse = await request
                .post(`/incident/${projectId}/resolve/${incidentId}`)
                .set('Authorization', authorization);

            expect(incidentResolveEndpointResponse).to.have.status(200);

            await sleep(10 * 1000);

            // slug is what is been used to query subscriber and onCall
            // The slug is gotten from the schema of the database
            const slug = incidentResolveEndpointResponse.body.incident.slug;

            const subscribersAlertsEndpointReponse = await request
                .get(
                    `/subscriberAlert/${projectId}/incident/${slug}?skip=0&limit=999`
                )
                .set('Authorization', authorization);

            expect(subscribersAlertsEndpointReponse).to.have.status(200);
            expect(subscribersAlertsEndpointReponse.body).to.an('object');
            expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
            expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
            expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(
                2
            );

            const eventTypesSent = [];
            for (const event of subscribersAlertsEndpointReponse.body.data) {
                const {
                    alertStatus,
                    alertVia,
                    eventType,
                    error,
                    errorMessage,
                } = event;
                eventTypesSent.push(eventType);
                expect(alertStatus).to.equal('Success');
                expect(alertVia).to.equal('sms');
                expect(error).to.equal(false);
                expect(errorMessage).to.equal(undefined);
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const oncallAlertsEndpointReponse = await request
                .get(`/alert/${projectId}/incident/${slug}?skip=0&limit=999`)
                .set('Authorization', authorization);

            expect(oncallAlertsEndpointReponse).to.have.status(200);
            expect(oncallAlertsEndpointReponse.body).to.an('object');
            expect(oncallAlertsEndpointReponse.body.count).to.be.greaterThan(0);
            expect(oncallAlertsEndpointReponse.body.data).to.an('array');
            expect(
                oncallAlertsEndpointReponse.body.data.length
            ).to.be.greaterThan(0);
            const alertsSentList = [];
            for (const event of oncallAlertsEndpointReponse.body.data) {
                const { alertVia, alertStatus, error } = event;
                expect(alertStatus).to.equal('Success');
                expect(error).to.equal(false);
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
        });
        /**
         * Global twilio settings: not set
         * Custom twilio settings: not set
         */

        it('should not SMS/Call alerts to on-call teams and subscriber if global and custom twilio settings are removed.', async function() {
            await GlobalConfigModel.deleteMany({
                name: 'twilio',
            });

            const getCustomTwilioSettingResponse = await request
                .get(`/smsSmtp/${projectId}/`)
                .set('Authorization', authorization);
            expect(getCustomTwilioSettingResponse).to.have.status(200);
            expect(getCustomTwilioSettingResponse.body).to.be.an('object');

            const { _id: smsSmtpId } = getCustomTwilioSettingResponse.body;

            if (smsSmtpId) {
                const deleteCustomTwilioSettingResponse = await request
                    .delete(`/smsSmtp/${projectId}/${smsSmtpId}`)
                    .set('Authorization', authorization);
                expect(deleteCustomTwilioSettingResponse).to.have.status(200);
            }

            const incidentCreationEndpointResponse = await request
                .post(`/incident/${projectId}/create-incident`)
                .set('Authorization', authorization)
                .send({
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                });
            expect(incidentCreationEndpointResponse).to.have.status(200);

            const { _id: incidentId } = incidentCreationEndpointResponse.body;

            const incidentResolveEndpointResponse = await request
                .post(`/incident/${projectId}/resolve/${incidentId}`)
                .set('Authorization', authorization);

            expect(incidentResolveEndpointResponse).to.have.status(200);

            await sleep(10 * 1000);

            // slug is what is been used to query subscriber and onCall
            // The slug is gotten from the schema of the database
            const slug = incidentResolveEndpointResponse.body.incident.slug;

            const subscribersAlertsEndpointReponse = await request
                .get(
                    `/subscriberAlert/${projectId}/incident/${slug}?skip=0&limit=999`
                )
                .set('Authorization', authorization);

            expect(subscribersAlertsEndpointReponse).to.have.status(200);
            expect(subscribersAlertsEndpointReponse.body).to.an('object');
            expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
            expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
            expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(
                2
            );

            const eventTypesSent = [];
            for (const event of subscribersAlertsEndpointReponse.body.data) {
                const {
                    alertStatus,
                    alertVia,
                    eventType,
                    error,
                    errorMessage,
                } = event;
                eventTypesSent.push(eventType);
                expect(alertStatus).to.equal(null);
                expect(alertVia).to.equal('sms');
                expect(error).to.equal(true);
                expect(errorMessage).to.equal(
                    'Twilio Settings not found on Admin Dashboard'
                );
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const oncallAlertsEndpointReponse = await request
                .get(`/alert/${projectId}/incident/${slug}?skip=0&limit=999`)
                .set('Authorization', authorization);

            expect(oncallAlertsEndpointReponse).to.have.status(200);
            expect(oncallAlertsEndpointReponse.body).to.an('object');
            expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
            expect(oncallAlertsEndpointReponse.body.data).to.an('array');
            expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
            const alertsSentList = [];
            for (const event of oncallAlertsEndpointReponse.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
                expect(alertStatus).to.equal(null);
                expect(error).to.equal(true);
                expect(errorMessage).to.equal(
                    'Twilio Settings not found on Admin Dashboard'
                );
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
        });
    });
});
