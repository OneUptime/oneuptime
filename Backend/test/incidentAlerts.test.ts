process.env['PORT'] = 3020;
import userData from './data/user';
import chai, { expect } from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import chaiSubset from 'chai-subset';
chai.use(chaiSubset);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
const {
    addEscalation,
    addSubscriberToMonitor,
    createComponent,
    createIncident,
    createMonitor,
    createSchedule,
    getAuthorizationHeader,
    getOnCallAlerts,
    getSubscribersAlerts,
    login,
    markIncidentAsResolved,
    updateSchedule,
    verifyToken,
    getChargedAlerts,
} = require('./utils/test-utils');
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ComponentService from '../backend/services/componentService';
import MonitorService from '../backend/services/monitorService';
import NotificationService from '../backend/services/notificationService';
import AirtableService from '../backend/services/airtableService';
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
import LoginIPLog from '../backend/models/loginIPLog';

import VerificationTokenModel from '../backend/models/verificationToken';
import UserModel from '../backend/models/user';
import GlobalConfigModel from '../backend/models/globalConfig';
import GlobalConfigService from '../backend/services/globalConfigService';
import EmailSmtpService from '../backend/services/emailSmtpService';
import AlertChargeService from '../backend/services/alertChargeService';

import { formatBalance } from '../backend/utils/number';
import TeamMembers from './utils/teamMembers';
import MonitorCriteriaService from '../backend/services/monitorCriteriaService';

import { generateRandomString } from './utils/string';

import uuid from 'uuid';
import axios from 'axios';

const sleep: Function = (waitTimeInMs: $TSFixMe): void => {
    return new Promise((resolve: $TSFixMe) => {
        setTimeout(resolve, waitTimeInMs);
    });
};

let authorization: $TSFixMe,
    userId: ObjectID,
    projectId: ObjectID,
    componentId: $TSFixMe,
    monitorId: $TSFixMe,
    scheduleId: $TSFixMe;

describe('SMS/Calls Incident Alerts', function (): void {
    this.timeout(30000);

    before(async function (): void {
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
        const user: $TSFixMe = await createUser(request, userData.user);
        const project: $TSFixMe = user.body.project;
        projectId = project._id;
        userId = user.body.id;

        await UserModel.updateOne(
            { _id: userId },
            { alertPhoneNumber: '+19173976235' }
        );

        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        const token: $TSFixMe = verificationToken.token;
        await verifyToken({ request, token });
        const { email, password }: $TSFixMe = userData.user;
        const userLogin: $TSFixMe = await login({ request, email, password });
        const jwtToken: $TSFixMe = userLogin.body.tokens.jwtAccessToken;
        authorization = getAuthorizationHeader({ jwtToken });

        const component: $TSFixMe = await createComponent({
            request,
            authorization,
            projectId,
            payload: {
                projectId,
                name: 'test',
                criteria: {},
                data: {},
            },
        });
        componentId = component.body._id;

        const monitor: $TSFixMe = await createMonitor({
            request,
            authorization,
            projectId,
            payload: {
                componentId,
                projectId,
                type: null, //Please add a new monitor type here. IOT Device Monitor has been removed.
                name: 'test monitor ',
                data: null,
                deviceId: null,
                criteria: {},
            },
        });
        monitorId = monitor.body._id;

        await request
            .post(`/stripe/${projectId}/addBalance`)
            .set('Authorization', authorization)
            .send({
                rechargeBalanceAmount: '2000',
            });

        await addSubscriberToMonitor({
            request,
            authorization,
            monitorId,
            projectId,
            payload: {
                alertVia: 'sms',
                contactPhone: '9173976235',
                countryCode: 'us',
            },
        });

        const schedule: $TSFixMe = await createSchedule({
            request,
            authorization,
            projectId,
            name: 'test schedule',
        });
        scheduleId = schedule.body._id;

        await updateSchedule({
            request,
            authorization,
            projectId,
            scheduleId,
            payload: { monitorIds: [monitorId] },
        });

        await addEscalation({
            request,
            authorization,
            projectId,
            scheduleId,
            payload: [
                {
                    callReminders: '1',
                    smsReminders: '1',
                    emailReminders: '1',
                    email: false,
                    sms: true,
                    call: true,
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
            ],
        });
    });

    after(async (): void => {
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
        await VerificationTokenModel.deleteMany({ userId });
        await LoginIPLog.deleteMany({ userId });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    describe('Global twilio credentials set (and Custom twilio settings not set)', async () => {
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings (SMS/Call) enable : true
         * SMS/Call alerts enabled for the project (billing): true
         * The project's balance is zero.
         */

        it('should send SMS/Call alerts to on-call teams and subscribers if project balance is 0, and custom twilio settings are not set.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);
            await ProjectService.updateBy({ _id: projectId }, { balance: 0 });

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];

            // Because the project balance recharges, the alerts should be sent
            for (const event of subscribersAlerts.body.data) {
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
                expect(errorMessage).to.be.undefined;
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
                expect(alertStatus).to.equal('Success');
                expect(error).to.equal(false);
                expect(errorMessage).to.be.undefined;
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
            await ProjectService.updateBy(
                { _id: projectId },
                { balance: 2000 }
            );
        });
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings (SMS/Call) enable : true
         * SMS/Call alerts enabled for the project (billing): true
         * The US numbers are disabled
         */

        it('should not send SMS/Call alerts to on-call teams and subscribers if the used phone numbers are from US, the US numbers are disabled, and the custom twilio settings are not set.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: false,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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
                    'SMS for numbers inside US not enabled for this project'
                );
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
                expect(alertStatus).to.equal(null);
                if (alertVia === 'sms') {
                    expect(error).to.equal(true);
                    expect(errorMessage).equal(
                        'SMS for numbers inside US not enabled for this project'
                    );
                }
                if (alertVia === 'call') {
                    expect(error).to.equal(true);
                    expect(errorMessage).equal(
                        'Calls for numbers inside US not enabled for this project'
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
         * Global twilio settings (SMS/Call) enable : true
         * SMS/Call alerts enabled for the project (billing): true
         * The High risks countries are disabled
         */

        it('should not send SMS/Call alerts to on-call teams and subscribers if the used phone numbers are from high risk countries, the high risk countries numbers are disabled, and the custom twilio settings are not set.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: false,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);
            await UserService.updateBy(
                { _id: userId },
                { alertPhoneNumber: '+216595960020' }
            );
            await SubscriberService.updateBy(
                { projectId, alertVia: 'sms' },
                {
                    countryCode: 'tn',
                    contactPhone: '595960020',
                }
            );

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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
                    'SMS to High Risk country not enabled for this project'
                );
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
                expect(alertStatus).to.equal(null);
                if (alertVia === 'sms') {
                    expect(error).to.equal(true);
                    expect(errorMessage).equal(
                        'SMS to High Risk country not enabled for this project'
                    );
                }
                if (alertVia === 'call') {
                    expect(error).to.equal(true);
                    expect(errorMessage).equal(
                        'Calls to High Risk country not enabled for this project'
                    );
                }
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
            await UserService.updateBy(
                { _id: userId },
                { alertPhoneNumber: '+19173976235' }
            );
            await SubscriberService.updateBy(
                { projectId, alertVia: 'sms' },
                {
                    countryCode: 'us',
                    contactPhone: '9173976235',
                }
            );
        });
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings (SMS/Call) enable : true
         * SMS/Call alerts enabled for the project (billing): true
         * The Non-US countries are disabled
         */

        it('should not send SMS/Call alerts to on-call teams and subscribers if the used phone numbers are outside US, the outside US numbers are disabled, and the custom twilio settings are not set.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: false,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);
            await UserService.updateBy(
                { _id: userId },
                { alertPhoneNumber: '+213595960020' }
            );
            await SubscriberService.updateBy(
                { projectId, alertVia: 'sms' },
                {
                    countryCode: 'dz',
                    contactPhone: '595960020',
                }
            );

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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
                    'SMS for numbers outside US not enabled for this project'
                );
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
                expect(alertStatus).to.equal(null);
                if (alertVia === 'sms') {
                    expect(error).to.equal(true);
                    expect(errorMessage).equal(
                        'SMS for numbers outside US not enabled for this project'
                    );
                }
                if (alertVia === 'call') {
                    expect(error).to.equal(true);
                    expect(errorMessage).equal(
                        'Calls for numbers outside US not enabled for this project'
                    );
                }
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
            await UserService.updateBy(
                { _id: userId },
                { alertPhoneNumber: '+19173976235' }
            );
            await SubscriberService.updateBy(
                { projectId, alertVia: 'sms' },
                {
                    countryCode: 'us',
                    contactPhone: '9173976235',
                }
            );
        });
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings (SMS/Call) enable : true
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should send SMS/Call alerts to on-call teams and subscribers if the SMS/Call alerts are enabled globally and for the project.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error }: $TSFixMe = event;
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
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should notify the team set for a schedule, which is associated with a monitor criteriad', async function (): void {
            /*
             * Run the probe server for this test
             */

            this.timeout(180 * 1000);
            // First add a team member
            const userData: $TSFixMe = {
                email: `${generateRandomString()}@oneuptime.com`,
            };
            const newUser: $TSFixMe = await UserService.create(userData);

            const newUserId: $TSFixMe = newUser._id.toString();
            await UserModel.updateOne(
                { _id: newUserId },
                { alertPhoneNumber: `+251921615223`, isVerified: true }
            );

            const members: $TSFixMe = [
                {
                    userId: newUserId,
                    role: 'Member',
                },
            ];

            let updatedProject: $TSFixMe =
                await TeamMembers.addTeamMembersToProject(projectId, members);

            // A user was added when creating the project, so we expect a total of 2 members
            expect(updatedProject.users).to.have.lengthOf(2);

            // Create a new schedule
            const newSchedule: $TSFixMe = await createSchedule({
                request,
                authorization,
                projectId,
                name: generateRandomString(),
            });
            expect(newSchedule).to.have.status(200);

            const newScheduleId: $TSFixMe = newSchedule.body._id;

            // Add escalation for the new schedule, for the new member
            const escalations: $TSFixMe = await addEscalation({
                request,
                authorization,
                projectId,
                scheduleId: newScheduleId,
                payload: [
                    {
                        callReminders: '1',
                        smsReminders: '1',
                        emailReminders: '1',
                        email: false,
                        sms: true,
                        call: true,
                        teams: [
                            {
                                teamMembers: [
                                    {
                                        member: '',
                                        timezone: '',
                                        startTime: '',
                                        endTime: '',
                                        userId: newUserId,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            expect(escalations).to.have.status(200);

            // Create criteria, add a schedule to a new down criterion (non-default)
            const criteria: $TSFixMe = MonitorCriteriaService.create('url');

            criteria.down.push({
                ...criteria.down[0],
                default: false,
                name: 'Offline',
                scheduleIds: [newScheduleId],
            });

            // Create a new URL monitor, with a resource that will fail
            const url: string = 'https://httpbin.org/status/500';
            const newMonitor: $TSFixMe = await createMonitor({
                request,
                authorization,
                projectId,
                payload: {
                    componentId,
                    projectId,
                    type: 'url',
                    name: generateRandomString(10),
                    data: { url },

                    criteria,
                },
            });
            expect(newMonitor).to.have.status(200);
            const newMonitorId: $TSFixMe = newMonitor.body._id;

            // Let the probe server generate incident
            await sleep(120 * 1000);

            const { _id: lastIncidentId } = await IncidentService.findOneBy({
                query: { monitorId: newMonitorId },
                select: '_id',
            });

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId: lastIncidentId,
            });

            expect(onCallAlerts).to.have.status(200);

            // Two call alerts are expected for the user, one call and one sms
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data).to.have.lengthOf(2);
            onCallAlerts.body.data.forEach((alert: $TSFixMe) => {
                expect(alert.userId._id).to.equal(newUserId);
                expect(alert.monitorId._id).to.equal(newMonitorId);
            });

            // Remove the added team members
            updatedProject = await TeamMembers.removeTeamMembersFromProject(
                projectId,
                updatedProject.users.filter((user: $TSFixMe) => {
                    return user.userId === newUserId;
                })
            );
            expect(updatedProject.users).to.have.lengthOf(1);
            // Remove the monitor
            const removedMonitor: $TSFixMe = await MonitorService.deleteBy(
                {
                    _id: newMonitorId,
                },
                newUserId
            );
            expect(removedMonitor.toJSON()).to.have.ownProperty('deleted').that
                .is.true;
        });

        it('should notify the team set for a schedule, which is associated with a monitor criteria (incomingHttp monitor)', async function (): void {
            /*
             * Run the probe server for this test
             */

            this.timeout(180 * 1000);
            // First add a team member
            const userData: $TSFixMe = {
                email: `${generateRandomString()}@oneuptime.com`,
            };
            const newUser: $TSFixMe = await UserService.create(userData);

            const newUserId: $TSFixMe = newUser._id.toString();
            await UserModel.updateOne(
                { _id: newUserId },
                { alertPhoneNumber: `+251921615223`, isVerified: true }
            );

            const members: $TSFixMe = [
                {
                    userId: newUserId,
                    role: 'Member',
                },
            ];

            let updatedProject: $TSFixMe =
                await TeamMembers.addTeamMembersToProject(projectId, members);

            // A user was added when creating the project, so we expect a total of 2 members
            expect(updatedProject.users).to.have.lengthOf(2);

            // Create a new schedule
            const newSchedule: $TSFixMe = await createSchedule({
                request,
                authorization,
                projectId,
                name: generateRandomString(),
            });
            expect(newSchedule).to.have.status(200);

            const newScheduleId: $TSFixMe = newSchedule.body._id;

            // Add escalation for the new schedule, for the new member
            const escalations: $TSFixMe = await addEscalation({
                request,
                authorization,
                projectId,
                scheduleId: newScheduleId,
                payload: [
                    {
                        callReminders: '1',
                        smsReminders: '1',
                        emailReminders: '1',
                        email: false,
                        sms: true,
                        call: true,
                        teams: [
                            {
                                teamMembers: [
                                    {
                                        member: '',
                                        timezone: '',
                                        startTime: '',
                                        endTime: '',
                                        userId: newUserId,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            expect(escalations).to.have.status(200);

            // Create criteria, add a schedule to a down criterion
            const criteria: $TSFixMe = MonitorCriteriaService.create(
                'incomingHttpRequest'
            );

            const degradedCriterion: $TSFixMe = criteria.degraded[0];

            degradedCriterion.scheduleIds = [newScheduleId];

            const randomId: $TSFixMe = uuid.v4();

            const link: string = `http://localhost:${
                process.env['PORT'] || 3002
            }/api/incomingHttpRequest/${randomId}`;

            // Create a new incomingHttp monitor, with a resource that will fail
            const newMonitor: $TSFixMe = await createMonitor({
                request,
                authorization,
                projectId,
                payload: {
                    componentId,
                    projectId,
                    type: 'incomingHttpRequest',
                    name: generateRandomString(10),
                    criteria,
                    data: {
                        link,
                    },
                },
            });
            expect(newMonitor).to.have.status(200);

            const newMonitorId: $TSFixMe = newMonitor.body._id;

            // Create a degraded incident by sending an http request with no body
            const incomingHttpResponse: $TSFixMe = await axios.get(link);
            expect(incomingHttpResponse)
                .to.have.property('data')
                .that.has.property('status')
                .that.equals('degraded');

            // Wait for incident alerts
            await sleep(30 * 1000);

            const { _id: lastIncidentId } = await IncidentService.findOneBy({
                query: { monitorId: newMonitorId },
                select: '_id',
            });

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId: lastIncidentId,
            });

            expect(onCallAlerts).to.have.status(200);

            // Two call alerts are expected for the user, one call and one sms
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data).to.have.lengthOf(2);
            onCallAlerts.body.data.forEach((alert: $TSFixMe) => {
                expect(alert.userId._id).to.equal(newUserId);
                expect(alert.monitorId._id).to.equal(newMonitorId);
            });

            // Remove the added team members
            updatedProject = await TeamMembers.removeTeamMembersFromProject(
                projectId,
                updatedProject.users.filter((user: $TSFixMe) => {
                    return user.userId === newUserId;
                })
            );
            expect(updatedProject.users).to.have.lengthOf(1);
            // Remove the monitor
            const removedMonitor: $TSFixMe = await MonitorService.deleteBy(
                {
                    _id: newMonitorId,
                },
                newUserId
            );
            expect(removedMonitor.toJSON()).to.have.ownProperty('deleted').that
                .is.true;
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : false
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should use default criterion if no criterion is matched for an incident', async function (): void {
            /*
             * Run the probe server for this test
             */
            this.timeout(180 * 1000);
            // First add a team member
            const userData: $TSFixMe = {
                email: `${generateRandomString}@oneuptime.com`,
            };
            const newUser: $TSFixMe = await UserService.create(userData);

            const newUserId: $TSFixMe = newUser._id.toString();
            await UserModel.updateOne(
                { _id: newUserId },
                { alertPhoneNumber: `+251921615223`, isVerified: true }
            );

            const members: $TSFixMe = [
                {
                    userId: newUserId,
                    role: 'Member',
                },
            ];

            let updatedProject: $TSFixMe =
                await TeamMembers.addTeamMembersToProject(projectId, members);

            // A user was added when creating the project, so we expect a total of 2 members
            expect(updatedProject.users).to.have.lengthOf(2);

            // Create a new schedule
            const newSchedule: $TSFixMe = await createSchedule({
                request,
                authorization,
                projectId,
                name: generateRandomString(10),
            });
            expect(newSchedule).to.have.status(200);

            const newScheduleId: $TSFixMe = newSchedule.body._id;

            // Add escalation for the new schedule, for the new member
            const escalations: $TSFixMe = await addEscalation({
                request,
                authorization,
                projectId,
                scheduleId: newScheduleId,
                payload: [
                    {
                        callReminders: '1',
                        smsReminders: '1',
                        emailReminders: '1',
                        email: false,
                        sms: true,
                        call: true,
                        teams: [
                            {
                                teamMembers: [
                                    {
                                        member: '',
                                        timezone: '',
                                        startTime: '',
                                        endTime: '',
                                        userId: newUserId,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            expect(escalations).to.have.status(200);

            // Create criteria, but remove the all other down criteria so we only have default criteria
            const criteria: $TSFixMe = MonitorCriteriaService.create('url');
            // Add a schedule to the default criterion

            criteria.down[0].scheduleIds = [newScheduleId];
            // Create a new URL monitor, with a resource that will fail
            const url: string = 'https://httpbin.org/status/500';
            const newMonitor: $TSFixMe = await createMonitor({
                request,
                authorization,
                projectId,
                payload: {
                    componentId,
                    projectId,
                    type: 'url',
                    name: generateRandomString(),
                    data: { url },

                    criteria,
                },
            });
            expect(newMonitor).to.have.status(200);
            const newMonitorId: $TSFixMe = newMonitor.body._id;

            // Let the probe server generate incident
            await sleep(120 * 1000);

            const { _id: lastIncidentId } = await IncidentService.findOneBy({
                query: { monitorId: newMonitorId },
                select: '_id',
            });

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId: lastIncidentId,
            });

            expect(onCallAlerts).to.have.status(200);

            // Two call alerts are expected for the user, one call and one sms
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data).to.have.lengthOf(2);
            onCallAlerts.body.data.forEach((alert: $TSFixMe) => {
                expect(alert.userId._id).to.equal(newUserId);
                expect(alert.monitorId._id).to.equal(newMonitorId);
            });

            // Remove the added team members
            updatedProject = await TeamMembers.removeTeamMembersFromProject(
                projectId,
                updatedProject.users.filter((user: $TSFixMe) => {
                    return user.userId === newUserId;
                })
            );
            expect(updatedProject.users).to.have.lengthOf(1);

            // Remove the monitor
            const removedMonitor: $TSFixMe = await MonitorService.deleteBy(
                {
                    _id: newMonitorId,
                },
                newUserId
            );
            expect(removedMonitor.toJSON()).to.have.ownProperty('deleted').that
                .is.true;
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : false
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should create billing details of subscriber  when sms is sent on the chargeAlert', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            // Remove prior charge alerts (if created)
            await AlertChargeService.hardDeleteBy({});

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is degraded.',
                    incidentType: 'degraded',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            await sleep(10 * 1000);

            const chargeResponse: $TSFixMe = await getChargedAlerts({
                request,
                authorization,
                projectId,
            });
            expect(chargeResponse).to.have.status(200);
            expect(chargeResponse.body).to.an('object');
            /*
             * On the before hook, a subscriber is added, and the user
             * Is also added to duty for sms and call. So we expect
             * A total of 3 alert charges
             */
            expect(chargeResponse.body.count).to.equal(3);
            expect(chargeResponse.body.data).to.an('array');
            expect(chargeResponse.body.data.length).to.equal(3);

            const { _id: incidentId } = newIncident.body;
            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);
            await sleep(10 * 1000);
            const chargeResponseAfterResolvedIncident: $TSFixMe =
                await getChargedAlerts({
                    request,
                    authorization,
                    projectId,
                });
            expect(chargeResponseAfterResolvedIncident).to.have.status(200);
            expect(chargeResponseAfterResolvedIncident.body).to.an('object');
            /*
             * On the before hook, the call-duty limit is 1 SMS and 1 Call,
             * So now, no SMS and Call alerts are sent to the duty memeber
             */
            expect(chargeResponseAfterResolvedIncident.body.count).to.equal(4);
            expect(chargeResponseAfterResolvedIncident.body.data).to.an(
                'array'
            );
            expect(
                chargeResponseAfterResolvedIncident.body.data.length
            ).to.equal(4);
        });

        it('should not send Call alerts to on-call teams if the Call alerts are disabled in the global twilio configurations.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = false;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
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
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should not send SMS alerts to on-call teams and subscriber if the SMS alerts are disabled in the global twilio configurations.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = false;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
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
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): false
         */

        it('should not send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled for the project (billing).', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: false,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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
                    'Alert Disabled for this project'
                );
            }
            expect(eventTypesSent.includes('resolved')).to.equal(true);
            expect(eventTypesSent.includes('identified')).to.equal(true);

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
                expect(alertStatus).to.equal(null);
                expect(error).to.equal(true);
                expect(errorMessage).to.equal(
                    'Alert Disabled for this project'
                );
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
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should not send statusPageNote(investigation note) SMS notification when disabled', async (): void => {
            // Update global setting to enable SMS
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = false;

            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            // Enable billing for the project
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            // Disable status page note (investigation note) on the project
            const { enableInvestigationNoteNotificationSMS }: $TSFixMe =
                await ProjectService.updateOneBy(
                    { _id: projectId },
                    {
                        enableInvestigationNoteNotificationSMS: false,
                    }
                );

            expect(enableInvestigationNoteNotificationSMS).to.be.false;

            // Create an incident
            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const incidentId: $TSFixMe = newIncident.body._id;

            // Create a status page note (investiagation note)
            const statusPageNotePayload: $TSFixMe = {
                content: 'this is a test page note',
                incident_state: 'update',
                type: 'investigation',
            };

            const newStatusPageNote: $TSFixMe = await request
                .post(`/incident/${projectId}/incident/${incidentId}/message`)
                .set('Authorization', authorization)
                .send(statusPageNotePayload);

            expect(newStatusPageNote).to.have.status(200);

            // Resolve the incident
            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscriberAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscriberAlerts.body.data).to.be.an('array');

            const statusPageNoteNotificationAlert: $TSFixMe =
                subscriberAlerts.body.data.find((subscriberAlert: $TSFixMe) => {
                    return (
                        subscriberAlert.alertVia === 'sms' &&
                        subscriberAlert.errorMessage ===
                            'Investigation Note SMS Notification Disabled'
                    );
                });
            expect(statusPageNoteNotificationAlert).to.be.an('object');
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should not cut project balance for invalid twilio settings', async (): void => {
            // Update global setting to enable call and sms
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            // Add a wrong config to twilio
            const originalPhone: $TSFixMe = value.phone;
            value.phone = '+111111111';

            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            // Enable billing for the project
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            // Get the project balance before an alert is sent
            const { balance: originalProjectBalance } =
                await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'balance',
                });

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            // Resolve the incident
            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId: newIncident.body._id,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const { balance: newProjectBalance } =
                await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'balance',
                });

            expect(newProjectBalance).to.equal(originalProjectBalance);

            // Revert twilio settings
            value.phone = originalPhone;
            const revertedTwilioSettings: $TSFixMe =
                await GlobalConfigModel.findOneAndUpdate(
                    { name: 'twilio' },
                    { value },
                    { new: true }
                );
            expect(revertedTwilioSettings.value)
                .to.have.property('phone')
                .to.equal(originalPhone);
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should recharge project balance when low', async (): void => {
            // Update global setting to enable call and sms
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;

            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            // Enable billing for the project
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            // Set project balance to 0
            await ProjectService.updateOneBy(
                { _id: projectId },
                { balance: 0 }
            );

            // Send notification
            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            await sleep(10 * 1000);

            // Check the balance again

            const { balance, alertOptions }: $TSFixMe =
                await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'balance alertOptions',
                });

            const { rechargeToBalance, minimumBalance }: $TSFixMe =
                alertOptions;

            expect(balance).to.be.lessThan(rechargeToBalance);
            expect(balance).to.be.greaterThan(minimumBalance);
            // Resolve the incident
            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId: newIncident.body._id,
            });

            expect(incidentResolved).to.have.status(200);
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): true
         */

        it('should correctly register closing balance for alert charges', async function (): void {
            this.timeout(60 * 1000);

            // Update global setting to enable call and sms
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;

            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            // Enable billing for the project
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });

            expect(billingEndpointResponse).to.have.status(200);

            // Create multiple subscribers
            for (let i: $TSFixMe = 0; i < 10; i++) {
                const newSubscriber: $TSFixMe = await addSubscriberToMonitor({
                    request,
                    authorization,
                    monitorId,
                    projectId,
                    payload: {
                        alertVia: 'sms',
                        contactPhone: `92161522${i}`,
                        countryCode: 'et',
                    },
                });
                expect(newSubscriber).to.have.status(200);
            }

            await sleep(10 * 1000);

            // Clean up alert charges
            await AlertChargeService.hardDeleteBy({});
            // Get original project balance
            const { balance: originalProjectBalance } =
                await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'balance',
                });

            // Send notification
            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });

            expect(newIncident).to.have.status(200);

            await sleep(25 * 1000);

            // Get all alert charges sorted by date in descending order
            const alertCharges: $TSFixMe = await AlertChargeService.findBy(
                {
                    incidentId: newIncident.body._id,
                    projectId,
                },

                null,
                null,
                1
            );
            expect(alertCharges).to.be.an('array');

            let calculatedBalance: $TSFixMe = originalProjectBalance;
            /*
             * Calculate balance for each alert charge amount and compare it with
             * Alert charge's closing balance
             */
            const allAlertChargesCorrect: $TSFixMe = alertCharges.every(
                (alertCharge: $TSFixMe) => {
                    calculatedBalance = formatBalance(
                        calculatedBalance - alertCharge.chargeAmount
                    );

                    return (
                        calculatedBalance === alertCharge.closingAccountBalance
                    );
                }
            );

            expect(allAlertChargesCorrect).to.be.true;

            // Resolve the incident
            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId: newIncident.body._id,
            });

            expect(incidentResolved).to.have.status(200);

            // Clean up subscribers
            await SubscriberService.hardDeleteBy({
                contactPhone: /92161522/,
                countryCode: 'et',
            });
        });
    });

    describe('Custom twilio settings are set', async () => {
        /**
         * Global twilio settings: set
         * Custom twilio settings: set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): false
         */

        it('should send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled for the project (billing).', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: false,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const customTwilioSettingResponse: $TSFixMe = await request
                .post(`/smsSmtp/${projectId}`)
                .set('Authorization', authorization)
                .send({
                    accountSid: 'AC4b957669470069d68cd5a09d7f91d7c6',
                    authToken: '79a35156d9967f0f6d8cc0761ef7d48d',
                    enabled: true,
                    phoneNumber: '+15005550006',
                });
            expect(customTwilioSettingResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error }: $TSFixMe = event;
                expect(alertStatus).to.equal('Success');
                expect(error).to.equal(false);
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: set
         * Global twilio settings SMS enable : false
         * Global twilio settings Call enable : false
         * SMS/Call alerts enabled for the project (billing): false
         */

        it('should send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled in the global twilio settings.', async (): void => {
            const globalSettings: $TSFixMe = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value }: $TSFixMe = globalSettings;
            value['sms-enabled'] = false;
            value['call-enabled'] = false;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: false,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const getCustomTwilioSettingResponse: $TSFixMe = await request
                .get(`/smsSmtp/${projectId}/`)
                .set('Authorization', authorization);
            expect(getCustomTwilioSettingResponse).to.have.status(200);
            expect(getCustomTwilioSettingResponse.body).to.be.an('object');

            const { _id: smsSmtpId } = getCustomTwilioSettingResponse.body;

            const customTwilioSettingResponse: $TSFixMe = await request
                .put(`/smsSmtp/${projectId}/${smsSmtpId}`)
                .set('Authorization', authorization)
                .send({
                    accountSid: 'AC4b957669470069d68cd5a09d7f91d7c6',
                    authToken: '79a35156d9967f0f6d8cc0761ef7d48d',
                    enabled: true,
                    phoneNumber: '+15005550006',
                });
            expect(customTwilioSettingResponse).to.have.status(200);

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error }: $TSFixMe = event;
                expect(alertStatus).to.equal('Success');
                expect(error).to.equal(false);
                alertsSentList.push(alertVia);
            }
            expect(alertsSentList.includes('sms')).to.equal(true);
            expect(alertsSentList.includes('call')).to.equal(true);
        });
        /**
         * Global twilio settings: not set
         * Custom twilio settings: not set
         */

        it('should not SMS/Call alerts to on-call teams and subscriber if global and custom twilio settings are removed.', async (): void => {
            await GlobalConfigModel.deleteMany({ name: 'twilio' });
            const billingEndpointResponse: $TSFixMe = await request
                .put(`/project/${projectId}/alertOptions`)
                .set('Authorization', authorization)
                .send({
                    alertEnable: true,
                    billingNonUSCountries: true,
                    billingRiskCountries: true,
                    billingUS: true,
                    minimumBalance: '100',
                    rechargeToBalance: '200',
                    _id: projectId,
                });
            expect(billingEndpointResponse).to.have.status(200);

            const getCustomTwilioSettingResponse: $TSFixMe = await request
                .get(`/smsSmtp/${projectId}/`)
                .set('Authorization', authorization);
            expect(getCustomTwilioSettingResponse).to.have.status(200);
            expect(getCustomTwilioSettingResponse.body).to.be.an('object');

            const { _id: smsSmtpId } = getCustomTwilioSettingResponse.body;

            if (smsSmtpId) {
                const deleteCustomTwilioSettingResponse: $TSFixMe =
                    await request
                        .delete(`/smsSmtp/${projectId}/${smsSmtpId}`)
                        .set('Authorization', authorization);
                expect(deleteCustomTwilioSettingResponse).to.have.status(200);
            }

            const newIncident: $TSFixMe = await createIncident({
                request,
                authorization,
                projectId,
                payload: {
                    monitors: [monitorId],
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved: $TSFixMe = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscribersAlerts).to.have.status(200);
            expect(subscribersAlerts.body).to.an('object');
            expect(subscribersAlerts.body.count).to.equal(2);
            expect(subscribersAlerts.body.data).to.an('array');
            expect(subscribersAlerts.body.data.length).to.equal(2);

            const eventTypesSent: $TSFixMe = [];
            for (const event of subscribersAlerts.body.data) {
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

            const onCallAlerts: $TSFixMe = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(onCallAlerts).to.have.status(200);
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data.length).to.equal(2);
            const alertsSentList: $TSFixMe = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage }: $TSFixMe =
                    event;
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

describe('Email Incident Alerts', (): void => {
    before(async function (): void {
        this.timeout(30000);
        const createdUser: $TSFixMe = await createUser(request, userData.user);
        const project: $TSFixMe = createdUser.body.project;
        projectId = project._id;
        userId = createdUser.body.id;
        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        const token: $TSFixMe = verificationToken.token;
        await verifyToken({ request, token });
        const { email, password }: $TSFixMe = userData.user;
        const userLogin: $TSFixMe = await login({ request, email, password });
        const jwtToken: $TSFixMe = userLogin.body.tokens.jwtAccessToken;
        authorization = getAuthorizationHeader({ jwtToken });
        const component: $TSFixMe = await createComponent({
            request,
            authorization,
            projectId,
            payload: {
                projectId,
                name: 'test',
                criteria: {},
                data: {},
            },
        });
        componentId = component.body._id;
        const monitor: $TSFixMe = await createMonitor({
            request,
            authorization,
            projectId,
            payload: {
                componentId,
                projectId,
                type: 'device',
                name: 'test monitor ',
                data: { deviceId: 'abcdef' },
                deviceId: 'abcdef',
                criteria: {},
            },
        });
        monitorId = monitor.body._id;
        await addSubscriberToMonitor({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                alertVia: 'email',
                contactEmail: 'test@hackerbay.io',
            },
        });
        const schedule: $TSFixMe = await createSchedule({
            request,
            authorization,
            projectId,
            name: 'test schedule',
        });
        scheduleId = schedule.body._id;
        await updateSchedule({
            request,
            authorization,
            projectId,
            scheduleId,
            payload: {
                monitorIds: [monitorId],
            },
        });
        await addEscalation({
            request,
            authorization,
            projectId,
            scheduleId,
            payload: [
                {
                    callReminders: '1',
                    smsReminders: '1',
                    emailReminders: '1',
                    email: true,
                    sms: false,
                    call: false,
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
            ],
        });
    });

    after(async function (): void {
        this.timeout(30000);
        await GlobalConfig.removeTestConfig();
        await OnCallScheduleStatusService.hardDeleteBy({ project: projectId });
        await SubscriberService.hardDeleteBy({ projectId });
        await SubscriberAlertService.hardDeleteBy({ projectId });
        await ScheduleService.hardDeleteBy({ projectId });
        await EscalationService.hardDeleteBy({ projectId });
        await IncidentService.hardDeleteBy({ projectId });
        await AlertService.hardDeleteBy({ projectId });
        await MonitorStatusModel.deleteMany({ monitorId });
        await IncidentPriorityModel.deleteMany({ projectId });
        await AlertChargeModel.deleteMany({ projectId });
        await IncidentMessageModel.deleteMany({ createdById: userId });
        await IncidentTimelineModel.deleteMany({ createdById: userId });
        await VerificationTokenModel.deleteMany({ userId });
        await LoginIPLog.deleteMany({ userId });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    /**
     * Global SMTP configurations : not set.
     * Custom SMTP congigurations : not set.
     */

    it('should not send Email alerts if no SMTP configurations are set.', async function (): void {
        this.timeout(30000);
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(subscribersAlerts).to.have.status(200);
        expect(subscribersAlerts.body).to.an('object');
        expect(subscribersAlerts.body.count).to.equal(2);
        expect(subscribersAlerts.body.data).to.an('array');
        expect(subscribersAlerts.body.data.length).to.equal(2);
        const eventTypesSent: $TSFixMe = [];
        for (const event of subscribersAlerts.body.data) {
            const {
                alertStatus,
                alertVia,
                eventType,
                error,
                errorMessage,
            }: $TSFixMe = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal(null);
            expect(alertVia).to.equal('email');
            expect(error).to.equal(true);
            expect(errorMessage).to.equal(
                'SMTP Settings not found on Admin Dashboard'
            );
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);

        const onCallAlerts: $TSFixMe = await getOnCallAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(onCallAlerts).to.have.status(200);
        expect(onCallAlerts.body).to.an('object');
        expect(onCallAlerts.body.count).to.equal(2);
        expect(onCallAlerts.body.data).to.an('array');
        expect(onCallAlerts.body.data.length).to.equal(2);

        const eventTypesSentToTeamMembers: $TSFixMe = [];
        for (const onCallAlert of onCallAlerts.body.data) {
            const {
                alertVia,
                eventType,
                alertStatus,
                error,
                errorMessage,
            }: $TSFixMe = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal(null);
            expect(error).to.equal(true);
            expect(errorMessage).equal(
                'SMTP Settings not found on Admin Dashboard'
            );
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(
            true
        );
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts disabled.
     * Custom SMTP congigurations : not set.
     */

    it('should not send Email alerts if global SMTP configurations are set and email are disabled in global configurations.', async function (): void {
        this.timeout(30000);
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': false,
                email: 'ibukun.o.dairo@gmail.com',
                password: 'ZEC1kY9xFN6aVf3j',
                'from-name': 'Ibukun',
                from: 'ibukun.o.dairo@gmail.com',
                'smtp-server': 'smtp-relay.sendinblue.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(subscribersAlerts).to.have.status(200);
        expect(subscribersAlerts.body).to.an('object');
        expect(subscribersAlerts.body.count).to.equal(2);
        expect(subscribersAlerts.body.data).to.an('array');
        expect(subscribersAlerts.body.data.length).to.equal(2);
        const eventTypesSent: $TSFixMe = [];
        for (const event of subscribersAlerts.body.data) {
            const {
                alertStatus,
                alertVia,
                eventType,
                error,
                errorMessage,
            }: $TSFixMe = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal(null);
            expect(alertVia).to.equal('email');
            expect(error).to.equal(true);
            expect(errorMessage).to.equal('Alert Disabled on Admin Dashboard');
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts: $TSFixMe = await getOnCallAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(onCallAlerts).to.have.status(200);
        expect(onCallAlerts.body).to.an('object');
        expect(onCallAlerts.body.count).to.equal(2);
        expect(onCallAlerts.body.data).to.an('array');
        expect(onCallAlerts.body.data.length).to.equal(2);

        const eventTypesSentToTeamMembers: $TSFixMe = [];
        for (const onCallAlert of onCallAlerts.body.data) {
            const {
                alertVia,
                eventType,
                alertStatus,
                error,
                errorMessage,
            }: $TSFixMe = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal(null);
            expect(error).to.equal(true);
            expect(errorMessage).equal('Alert Disabled on Admin Dashboard');
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(
            true
        );
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts enabled.
     * Custom SMTP congigurations : not set.
     */

    it('should send Email alerts if global SMTP configurations are set and email are enabled in global configurations.', async function (): void {
        this.timeout(30000);
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': true,
                email: 'ibukun.o.dairo@gmail.com',
                password: 'ZEC1kY9xFN6aVf3j',
                'from-name': 'Ibukun',
                from: 'ibukun.o.dairo@gmail.com',
                'smtp-server': 'smtp-relay.sendinblue.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(subscribersAlerts).to.have.status(200);
        expect(subscribersAlerts.body).to.an('object');
        expect(subscribersAlerts.body.count).to.equal(2);
        expect(subscribersAlerts.body.data).to.an('array');
        expect(subscribersAlerts.body.data.length).to.equal(2);
        const eventTypesSent: $TSFixMe = [];
        for (const event of subscribersAlerts.body.data) {
            const { alertStatus, alertVia, eventType, error }: $TSFixMe = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal('Sent');
            expect(alertVia).to.equal('email');
            expect(error).to.equal(false);
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts: $TSFixMe = await getOnCallAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(onCallAlerts).to.have.status(200);
        expect(onCallAlerts.body).to.an('object');
        expect(onCallAlerts.body.count).to.equal(2);
        expect(onCallAlerts.body.data).to.an('array');
        expect(onCallAlerts.body.data.length).to.equal(2);

        const eventTypesSentToTeamMembers: $TSFixMe = [];
        for (const onCallAlert of onCallAlerts.body.data) {
            const {
                alertVia,
                eventType,
                alertStatus,
                error,
                errorMessage,
            }: $TSFixMe = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal('Success');
            expect(error).to.equal(false);
            expect(errorMessage).to.be.undefined;
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(
            true
        );
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts enabled.
     * Custom SMTP configurations : not set.
     * investigation note email notification : not set
     */

    it('should not send statusPageNote(investigation note) Email notification when disabled', async function (): void {
        this.timeout(30 * 1000);
        // Update global smtp settings
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': true,
                email: 'ibukun.o.dairo@gmail.com',
                password: 'ZEC1kY9xFN6aVf3j',
                'from-name': 'Ibukun',
                from: 'ibukun.o.dairo@gmail.com',
                'smtp-server': 'smtp-relay.sendinblue.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });

        // Disable status page note (investigation note) Email notification on the project
        const { enableInvestigationNoteNotificationEmail }: $TSFixMe =
            await ProjectService.updateOneBy(
                { _id: projectId },
                {
                    enableInvestigationNoteNotificationEmail: false,
                }
            );

        expect(enableInvestigationNoteNotificationEmail).to.be.false;

        // Create an incident
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);

        const incidentId: $TSFixMe = newIncident.body._id;

        // Create a status page note (investigation note)
        const statusPageNotePayload: $TSFixMe = {
            content: 'this is a test investigation note',
            incident_state: 'update',
            type: 'investigation',
        };

        const newStatusPageNote: $TSFixMe = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send(statusPageNotePayload);

        expect(newStatusPageNote).to.have.status(200);

        // Resolve the incident
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(incidentResolved).to.have.status(200);

        await sleep(10 * 1000);

        const subscriberAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(subscriberAlerts.body.data).to.be.an('array');

        const statusPageNoteNotificationAlert: $TSFixMe =
            subscriberAlerts.body.data.find((subscriberAlert: $TSFixMe) => {
                return (
                    subscriberAlert.alertVia === 'email' &&
                    subscriberAlert.errorMessage ===
                        'Investigation Note Email Notification Disabled'
                );
            });
        expect(statusPageNoteNotificationAlert).to.be.an('object');
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts disabled.
     * Custom SMTP congigurations : set.
     */

    it('should send Email alerts if global SMTP configurations are set, email alerts disabled in global configurations, and custom SMTP settings are set.', async function (): void {
        this.timeout(30000);
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': false,
                email: 'ibukun.o.dairo@gmail.com',
                password: 'ZEC1kY9xFN6aVf3j',
                'from-name': 'Ibukun',
                from: 'ibukun.o.dairo@gmail.com',
                'smtp-server': 'smtp-relay.sendinblue.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });
        await EmailSmtpService.create({
            projectId,
            user: 'ibukun.o.dairo@gmail.com',
            pass: 'ZEC1kY9xFN6aVf3j',
            host: 'smtp-relay.sendinblue.com',
            port: '465',
            from: 'ibukun.o.dairo@gmail.com',
            name: 'Ibukun',
            secure: true,
        });
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(subscribersAlerts).to.have.status(200);
        expect(subscribersAlerts.body).to.an('object');
        expect(subscribersAlerts.body.count).to.equal(2);
        expect(subscribersAlerts.body.data).to.an('array');
        expect(subscribersAlerts.body.data.length).to.equal(2);
        const eventTypesSent: $TSFixMe = [];
        for (const event of subscribersAlerts.body.data) {
            const { alertStatus, alertVia, eventType, error }: $TSFixMe = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal('Sent');
            expect(alertVia).to.equal('email');
            expect(error).to.equal(false);
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts: $TSFixMe = await getOnCallAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(onCallAlerts).to.have.status(200);
        expect(onCallAlerts.body).to.an('object');
        expect(onCallAlerts.body.count).to.equal(2);
        expect(onCallAlerts.body.data).to.an('array');
        expect(onCallAlerts.body.data.length).to.equal(2);

        const eventTypesSentToTeamMembers: $TSFixMe = [];
        for (const onCallAlert of onCallAlerts.body.data) {
            const {
                alertVia,
                eventType,
                alertStatus,
                error,
                errorMessage,
            }: $TSFixMe = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal('Success');
            expect(error).to.equal(false);
            expect(errorMessage).to.be.undefined;
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(
            true
        );
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
        await EmailSmtpService.hardDeleteBy({ projectId });
    });

    /**
     * Global SMTP configurations : not set.
     * Email alerts disabled.
     * Custom SMTP congigurations : set.
     */

    it('should send Email alerts if global SMTP configurations are not set, and custom SMTP settings are set.', async function (): void {
        this.timeout(30000);
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
        await EmailSmtpService.create({
            projectId,
            user: 'ibukun.o.dairo@gmail.com',
            pass: 'ZEC1kY9xFN6aVf3j',
            host: 'smtp-relay.sendinblue.com',
            port: '465',
            from: 'ibukun.o.dairo@gmail.com',
            name: 'Ibukun',
            secure: true,
        });
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(subscribersAlerts).to.have.status(200);
        expect(subscribersAlerts.body).to.an('object');
        expect(subscribersAlerts.body.count).to.equal(2);
        expect(subscribersAlerts.body.data).to.an('array');
        expect(subscribersAlerts.body.data.length).to.equal(2);
        const eventTypesSent: $TSFixMe = [];
        for (const event of subscribersAlerts.body.data) {
            const { alertStatus, alertVia, eventType, error }: $TSFixMe = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal('Sent');
            expect(alertVia).to.equal('email');
            expect(error).to.equal(false);
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts: $TSFixMe = await getOnCallAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(onCallAlerts).to.have.status(200);
        expect(onCallAlerts.body).to.an('object');
        expect(onCallAlerts.body.count).to.equal(2);
        expect(onCallAlerts.body.data).to.an('array');
        expect(onCallAlerts.body.data.length).to.equal(2);

        const eventTypesSentToTeamMembers: $TSFixMe = [];
        for (const onCallAlert of onCallAlerts.body.data) {
            const {
                alertVia,
                eventType,
                alertStatus,
                error,
                errorMessage,
            }: $TSFixMe = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal('Success');
            expect(error).to.equal(false);
            expect(errorMessage).to.be.undefined;
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(
            true
        );
        await EmailSmtpService.hardDeleteBy({ projectId });
    });
});

describe('Webhook Incident Alerts', function (): void {
    this.timeout(30 * 1000);

    before(async function (): void {
        this.timeout(30000);
        const createdUser: $TSFixMe = await createUser(request, userData.user);
        const project: $TSFixMe = createdUser.body.project;
        projectId = project._id;
        userId = createdUser.body.id;
        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        const token: $TSFixMe = verificationToken.token;
        await verifyToken({ request, token });
        const { email, password }: $TSFixMe = userData.user;
        const userLogin: $TSFixMe = await login({ request, email, password });
        const jwtToken: $TSFixMe = userLogin.body.tokens.jwtAccessToken;
        authorization = getAuthorizationHeader({ jwtToken });
        const component: $TSFixMe = await createComponent({
            request,
            authorization,
            projectId,
            payload: {
                projectId,
                name: 'test',
                criteria: {},
                data: {},
            },
        });
        componentId = component.body._id;
        const monitor: $TSFixMe = await createMonitor({
            request,
            authorization,
            projectId,
            payload: {
                componentId,
                projectId,
                type: 'device',
                name: 'test monitor ',
                data: { deviceId: 'abcdef' },
                deviceId: 'abcdef',
                criteria: {},
            },
        });
        monitorId = monitor.body._id;

        await addSubscriberToMonitor({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                alertVia: 'webhook',
                contactEmail: 'test@hackerbay.io',
                contactWebhook: 'http://localhost:3010/api/webhooks/',
                webhookMethod: 'post',
            },
        });

        const schedule: $TSFixMe = await createSchedule({
            request,
            authorization,
            projectId,
            name: 'test schedule',
        });
        scheduleId = schedule.body._id;
        await updateSchedule({
            request,
            authorization,
            projectId,
            scheduleId,
            payload: {
                monitorIds: [monitorId],
            },
        });
        await addEscalation({
            request,
            authorization,
            projectId,
            scheduleId,
            payload: [
                {
                    callReminders: '1',
                    smsReminders: '1',
                    emailReminders: '1',
                    email: true,
                    sms: false,
                    call: false,
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
            ],
        });
    });

    after(async function (): void {
        this.timeout(30000);
        await GlobalConfig.removeTestConfig();
        await OnCallScheduleStatusService.hardDeleteBy({ project: projectId });
        await SubscriberService.hardDeleteBy({ projectId });
        await SubscriberAlertService.hardDeleteBy({ projectId });
        await ScheduleService.hardDeleteBy({ projectId });
        await EscalationService.hardDeleteBy({ projectId });
        await IncidentService.hardDeleteBy({ projectId });
        await AlertService.hardDeleteBy({ projectId });
        await MonitorStatusModel.deleteMany({ monitorId });
        await IncidentPriorityModel.deleteMany({ projectId });
        await AlertChargeModel.deleteMany({ projectId });
        await IncidentMessageModel.deleteMany({ createdById: userId });
        await IncidentTimelineModel.deleteMany({ createdById: userId });
        await VerificationTokenModel.deleteMany({ userId });
        await LoginIPLog.deleteMany({ userId });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not send statusPageNote(investigation note) Webhook notification when disabled', async () => {
        // Disable status page note (investigation note) notification for webhooks
        const { enableInvestigationNoteNotificationWebhook }: $TSFixMe =
            await ProjectService.updateOneBy(
                { _id: projectId },
                {
                    enableInvestigationNoteNotificationWebhook: false,
                }
            );

        expect(enableInvestigationNoteNotificationWebhook).to.be.false;

        // Create an incident
        const newIncident: $TSFixMe = await createIncident({
            request,
            authorization,
            projectId,
            payload: {
                monitors: [monitorId],
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);

        const incidentId: $TSFixMe = newIncident.body._id;

        // Create a status page note (investigation note)
        const statusPageNotePayload: $TSFixMe = {
            content: 'this is a test investigation note',
            incident_state: 'update',
            type: 'investigation',
        };

        const newStatusPageNote: $TSFixMe = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send(statusPageNotePayload);

        expect(newStatusPageNote).to.have.status(200);

        // Resolve the incident
        const incidentResolved: $TSFixMe = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(incidentResolved).to.have.status(200);

        await sleep(10 * 1000);

        const subscriberAlerts: $TSFixMe = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(subscriberAlerts.body.data).to.be.an('array');

        const statusPageNoteNotificationAlert: $TSFixMe =
            subscriberAlerts.body.data.find((subscriberAlert: $TSFixMe) => {
                return (
                    subscriberAlert.alertVia === 'webhook' &&
                    subscriberAlert.errorMessage ===
                        'Investigation Note Webhook Notification Disabled'
                );
            });
        expect(statusPageNoteNotificationAlert).to.be.an('object');
    });
});
