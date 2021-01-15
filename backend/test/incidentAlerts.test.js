/* eslint-disable no-undef */
process.env.PORT = 3020;
const userData = require('./data/user');
const chai = require('chai');
const expect = require('chai').expect;
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
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
} = require('./test-utils');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const ComponentService = require('../backend/services/componentService');
const MonitorService = require('../backend/services/monitorService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');
const OnCallScheduleStatusService = require('../backend/services/onCallScheduleStatusService');
const SubscriberService = require('../backend/services/subscriberService');
const SubscriberAlertService = require('../backend/services/subscriberAlertService');
const ScheduleService = require('../backend/services/scheduleService');
const EscalationService = require('../backend/services/escalationService');
const MonitorStatusModel = require('../backend/models/monitorStatus');
const IncidentService = require('../backend/services/incidentService');
const IncidentSMSActionModel = require('../backend/models/incidentSMSAction');
const IncidentPriorityModel = require('../backend/models/incidentPriority');
const IncidentMessageModel = require('../backend/models/incidentMessage');
const IncidentTimelineModel = require('../backend/models/incidentTimeline');
const AlertService = require('../backend/services/alertService');
const AlertChargeModel = require('../backend/models/alertCharge');
const TwilioModel = require('../backend/models/twilio');
const VerificationToken = require('../backend/models/verificationToken');
const LoginIPLog = require('../backend/models/loginIPLog');

const VerificationTokenModel = require('../backend/models/verificationToken');
const UserModel = require('../backend/models/user');
const GlobalConfigModel = require('../backend/models/globalConfig');
const GlobalConfigService = require('../backend/services/globalConfigService');
const EmailSmtpService = require('../backend/services/emailSmtpService');
const AlertChargeService = require('../backend/services/alertChargeService');
const { formatBalance } = require('../backend/utils/number');
const TeamMembers = require('./utils/teamMembers');
const MonitorCriteriaService = require('../backend/services/monitorCriteriaService');
const { generateRandomString } = require('./utils/string');

const sleep = waitTimeInMs =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let authorization, userId, projectId, componentId, monitorId, scheduleId;

describe('SMS/Calls Incident Alerts', function() {
    this.timeout(30000);

    before(async function() {
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
        const user = await createUser(request, userData.user);
        const project = user.body.project;
        projectId = project._id;
        userId = user.body.id;

        await UserModel.updateOne(
            { _id: userId },
            { alertPhoneNumber: '+19173976235' }
        );

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        const token = verificationToken.token;
        await verifyToken({ request, token });
        const { email, password } = userData.user;
        const userLogin = await login({ request, email, password });
        const jwtToken = userLogin.body.tokens.jwtAccessToken;
        authorization = getAuthorizationHeader({ jwtToken });

        const component = await createComponent({
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

        const monitor = await createMonitor({
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

        const schedule = await createSchedule({
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
        it('should send SMS/Call alerts to on-call teams and subscribers if project balance is 0, and custom twilio settings are not set.', async function() {
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
            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];

            // because the project balance recharges, the alerts should be sent
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
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
        it('should not send SMS/Call alerts to on-call teams and subscribers if the used phone numbers are from US, the US numbers are disabled, and the custom twilio settings are not set.', async function() {
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
            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
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
        it('should not send SMS/Call alerts to on-call teams and subscribers if the used phone numbers are from high risk countries, the high risk countries numbers are disabled, and the custom twilio settings are not set.', async function() {
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
            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
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
        it('should not send SMS/Call alerts to on-call teams and subscribers if the used phone numbers are outside US, the outside US numbers are disabled, and the custom twilio settings are not set.', async function() {
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
            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
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
        it('should send SMS/Call alerts to on-call teams and subscribers if the SMS/Call alerts are enabled globally and for the project.', async function() {
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

            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
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
         * SMS/Call alerts enabled for the project (billing): true
         */
        it('should notify the team set for a schedule, which is associated with a monitor criteria', async function() {
            /*
             * run the probe server for this test
             */

            this.timeout(180 * 1000);
            // first add a team member
            const userData = {
                email: `${generateRandomString()}@fyipe.com`,
            };
            const newUser = await UserService.create(userData);

            const newUserId = newUser._id.toString();
            await UserModel.updateOne(
                { _id: newUserId },
                { alertPhoneNumber: `+251921615223`, isVerified: true }
            );

            const members = [
                {
                    userId: newUserId,
                    role: 'Member',
                },
            ];

            let updatedProject = await TeamMembers.addTeamMembersToProject(
                projectId,
                members
            );

            // a user was added when creating the project, so we expect a total of 2 members
            expect(updatedProject.users).to.have.lengthOf(2);

            // create a new schedule
            const newSchedule = await createSchedule({
                request,
                authorization,
                projectId,
                name: generateRandomString(),
            });
            expect(newSchedule).to.have.status(200);

            const newScheduleId = newSchedule.body._id;

            // add escalation for the new schedule, for the new member
            const escalations = await addEscalation({
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

            // create criteria, add a schedule to a down criterion
            const criteria = MonitorCriteriaService.create('url');
            const nonDefaultCriterionIndex = criteria.down.findIndex(
                criterion => criterion.default !== true
            );
            expect(nonDefaultCriterionIndex).to.be.greaterThan(-1);
            criteria.down[nonDefaultCriterionIndex].scheduleIds = [
                newScheduleId,
            ];
            // create a new URL monitor, with a resource that will fail
            const url = 'https://httpbin.org/status/500';
            const newMonitor = await createMonitor({
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
            const newMonitorId = newMonitor.body._id;

            // let the probe server generate incident
            await sleep(120 * 1000);

            const { _id: lastIncidentId } = await IncidentService.findOneBy({
                monitorId: newMonitorId,
            });

            const onCallAlerts = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId: lastIncidentId,
            });

            expect(onCallAlerts).to.have.status(200);

            // two call alerts are expected for the user, one call and one sms
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data).to.have.lengthOf(2);
            onCallAlerts.body.data.forEach(alert => {
                expect(alert.userId._id).to.equal(newUserId);
                expect(alert.monitorId._id).to.equal(newMonitorId);
            });

            // remove the added team members
            updatedProject = await TeamMembers.removeTeamMembersFromProject(
                projectId,
                updatedProject.users.filter(user => user.userId === newUserId)
            );
            expect(updatedProject.users).to.have.lengthOf(1);
            // remove the monitor
            const removedMonitor = await MonitorService.deleteBy(
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
        it('should use default criterion if no criterion is matched for an incident', async function() {
            /*
             * run the probe server for this test
             */
            this.timeout(180 * 1000);
            // first add a team member
            const userData = {
                email: `${generateRandomString}@fyipe.com`,
            };
            const newUser = await UserService.create(userData);

            const newUserId = newUser._id.toString();
            await UserModel.updateOne(
                { _id: newUserId },
                { alertPhoneNumber: `+251921615223`, isVerified: true }
            );

            const members = [
                {
                    userId: newUserId,
                    role: 'Member',
                },
            ];

            let updatedProject = await TeamMembers.addTeamMembersToProject(
                projectId,
                members
            );

            // a user was added when creating the project, so we expect a total of 2 members
            expect(updatedProject.users).to.have.lengthOf(2);

            // create a new schedule
            const newSchedule = await createSchedule({
                request,
                authorization,
                projectId,
                name: generateRandomString(10),
            });
            expect(newSchedule).to.have.status(200);

            const newScheduleId = newSchedule.body._id;

            // add escalation for the new schedule, for the new member
            const escalations = await addEscalation({
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

            // create criteria, but remove the all other down criteria so we only have default criteria
            const criteria = MonitorCriteriaService.create('url');
            criteria.down = criteria.down.filter(
                criterion => criterion.default === true
            );
            expect(criteria.down).to.have.lengthOf(1);
            // add a schedule to the default criterion
            criteria.down[0].scheduleIds = [newScheduleId];
            // create a new URL monitor, with a resource that will fail
            const url = 'https://httpbin.org/status/500';
            const newMonitor = await createMonitor({
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
            const newMonitorId = newMonitor.body._id;

            // let the probe server generate incident
            await sleep(120 * 1000);

            const { _id: lastIncidentId } = await IncidentService.findOneBy({
                monitorId: newMonitorId,
            });

            const onCallAlerts = await getOnCallAlerts({
                request,
                authorization,
                projectId,
                incidentId: lastIncidentId,
            });

            expect(onCallAlerts).to.have.status(200);

            // two call alerts are expected for the user, one call and one sms
            expect(onCallAlerts.body).to.an('object');
            expect(onCallAlerts.body.count).to.equal(2);
            expect(onCallAlerts.body.data).to.an('array');
            expect(onCallAlerts.body.data).to.have.lengthOf(2);
            onCallAlerts.body.data.forEach(alert => {
                expect(alert.userId._id).to.equal(newUserId);
                expect(alert.monitorId._id).to.equal(newMonitorId);
            });

            // remove the added team members
            updatedProject = await TeamMembers.removeTeamMembersFromProject(
                projectId,
                updatedProject.users.filter(user => user.userId === newUserId)
            );
            expect(updatedProject.users).to.have.lengthOf(1);

            // remove the monitor
            const removedMonitor = await MonitorService.deleteBy(
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

        it('should create billing details of subscriber  when sms is sent on the chargeAlert', async function() {
            const globalSettings = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value } = globalSettings;
            value['sms-enabled'] = true;
            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            const billingEndpointResponse = await request
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

            // remove prior charge alerts (if created)
            await AlertChargeService.hardDeleteBy({});

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is degraded.',
                    incidentType: 'degraded',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            await sleep(10 * 1000);

            const chargeResponse = await getChargedAlerts({
                request,
                authorization,
                projectId,
            });
            expect(chargeResponse).to.have.status(200);
            expect(chargeResponse.body).to.an('object');
            // on the before hook, a subscriber is added, and the user
            // is also added to duty for sms and call. So we expect
            // a total of 3 alert charges
            expect(chargeResponse.body.count).to.equal(3);
            expect(chargeResponse.body.data).to.an('array');
            expect(chargeResponse.body.data.length).to.equal(3);

            const { _id: incidentId } = newIncident.body;
            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);
            await sleep(10 * 1000);
            const chargeResponseAfterResolvedIncident = await getChargedAlerts({
                request,
                authorization,
                projectId,
            });
            expect(chargeResponseAfterResolvedIncident).to.have.status(200);
            expect(chargeResponseAfterResolvedIncident.body).to.an('object');
            // on the before hook, the call-duty limit is 1 SMS and 1 Call,
            // so now, no SMS and Call alerts are sent to the duty memeber
            expect(chargeResponseAfterResolvedIncident.body.count).to.equal(4);
            expect(chargeResponseAfterResolvedIncident.body.data).to.an(
                'array'
            );
            expect(
                chargeResponseAfterResolvedIncident.body.data.length
            ).to.equal(4);
        });
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

            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
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
         * SMS/Call alerts enabled for the project (billing): true
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

            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
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
        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): false
         */
        it('should not send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled for the project (billing).', async function() {
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

            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error, errorMessage } = event;
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
        it('should not send statusPageNote(investigation note) SMS notification when disabled', async function() {
            // update global setting to enable SMS
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

            // enable billing for the project
            const billingEndpointResponse = await request
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

            // disable status page note (investigation note) on the project
            const {
                enableInvestigationNoteNotificationSMS,
            } = await ProjectService.updateOneBy(
                { _id: projectId },
                {
                    enableInvestigationNoteNotificationSMS: false,
                }
            );

            expect(enableInvestigationNoteNotificationSMS).to.be.false;

            // create an incident
            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const incidentId = newIncident.body._id;

            // create a status page note (investiagation note)
            const statusPageNotePayload = {
                content: 'this is a test page note',
                incident_state: 'update',
                type: 'investigation',
            };

            const newStatusPageNote = await request
                .post(`/incident/${projectId}/incident/${incidentId}/message`)
                .set('Authorization', authorization)
                .send(statusPageNotePayload);

            expect(newStatusPageNote).to.have.status(200);

            // resolve the incident
            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscriberAlerts = await getSubscribersAlerts({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(subscriberAlerts.body.data).to.be.an('array');

            const statusPageNoteNotificationAlert = subscriberAlerts.body.data.find(
                subscriberAlert =>
                    subscriberAlert.alertVia === 'sms' &&
                    subscriberAlert.errorMessage ===
                        'Investigation Note SMS Notification Disabled'
            );
            expect(statusPageNoteNotificationAlert).to.be.an('object');
        });

        /**
         * Global twilio settings: set
         * Custom twilio settings: not set
         * Global twilio settings SMS enable : true
         * Global twilio settings Call enable : true
         * SMS/Call alerts enabled for the project (billing): true
         */
        it('should not cut project balance for invalid twilio settings', async function() {
            // update global setting to enable call and sms
            const globalSettings = await GlobalConfigModel.findOne({
                name: 'twilio',
            });
            const { value } = globalSettings;
            value['sms-enabled'] = true;
            value['call-enabled'] = true;
            // add a wrong config to twilio
            const originalPhone = value.phone;
            value.phone = '+111111111';

            await GlobalConfigModel.findOneAndUpdate(
                { name: 'twilio' },
                { value }
            );

            // enable billing for the project
            const billingEndpointResponse = await request
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

            // get the project balance before an alert is sent
            const {
                balance: originalProjectBalance,
            } = await ProjectService.findOneBy({ _id: projectId });

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            // resolve the incident
            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId: newIncident.body._id,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const {
                balance: newProjectBalance,
            } = await ProjectService.findOneBy({ _id: projectId });

            expect(newProjectBalance).to.equal(originalProjectBalance);

            // revert twilio settings
            value.phone = originalPhone;
            const revertedTwilioSettings = await GlobalConfigModel.findOneAndUpdate(
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
        it('should recharge project balance when low', async function() {
            // update global setting to enable call and sms
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

            // enable billing for the project
            const billingEndpointResponse = await request
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

            // set project balance to 0
            await ProjectService.updateOneBy(
                { _id: projectId },
                { balance: 0 }
            );

            // send notification
            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            await sleep(10 * 1000);

            // check the balance again

            const { balance, alertOptions } = await ProjectService.findOneBy({
                _id: projectId,
            });

            const { rechargeToBalance, minimumBalance } = alertOptions;

            expect(balance).to.be.lessThan(rechargeToBalance);
            expect(balance).to.be.greaterThan(minimumBalance);
            // resolve the incident
            const incidentResolved = await markIncidentAsResolved({
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
        it('should correctly register closing balance for alert charges', async function() {
            this.timeout(60 * 1000);

            // update global setting to enable call and sms
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

            // enable billing for the project
            const billingEndpointResponse = await request
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

            // create multiple subscribers
            for (let i = 0; i < 10; i++) {
                const newSubscriber = await addSubscriberToMonitor({
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

            // clean up alert charges
            await AlertChargeService.hardDeleteBy({});
            // get original project balance
            const {
                balance: originalProjectBalance,
            } = await ProjectService.findOneBy({
                _id: projectId,
            });

            // send notification
            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });

            expect(newIncident).to.have.status(200);

            await sleep(25 * 1000);

            // get all alert charges sorted by date in descending order
            const alertCharges = await AlertChargeService.findBy(
                {
                    incidentId: newIncident.body._id,
                    projectId,
                },
                null,
                null,
                1
            );
            expect(alertCharges).to.be.an('array');

            let calculatedBalance = originalProjectBalance;
            // calculate balance for each alert charge amount and compare it with
            // alert charge's closing balance
            const allAlertChargesCorrect = alertCharges.every(alertCharge => {
                calculatedBalance = formatBalance(
                    calculatedBalance - alertCharge.chargeAmount
                );

                return calculatedBalance === alertCharge.closingAccountBalance;
            });

            expect(allAlertChargesCorrect).to.be.true;

            // resolve the incident
            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId: newIncident.body._id,
            });

            expect(incidentResolved).to.have.status(200);

            // clean up subscribers
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
        it('should send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled for the project (billing).', async function() {
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
            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
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
         * Custom twilio settings: set
         * Global twilio settings SMS enable : false
         * Global twilio settings Call enable : false
         * SMS/Call alerts enabled for the project (billing): false
         */
        it('should send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled in the global twilio settings.', async function() {
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
            const billingEndpointResponse = await request
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

            const getCustomTwilioSettingResponse = await request
                .get(`/smsSmtp/${projectId}/`)
                .set('Authorization', authorization);
            expect(getCustomTwilioSettingResponse).to.have.status(200);
            expect(getCustomTwilioSettingResponse.body).to.be.an('object');

            const { _id: smsSmtpId } = getCustomTwilioSettingResponse.body;

            const customTwilioSettingResponse = await request
                .put(`/smsSmtp/${projectId}/${smsSmtpId}`)
                .set('Authorization', authorization)
                .send({
                    accountSid: 'AC4b957669470069d68cd5a09d7f91d7c6',
                    authToken: '79a35156d9967f0f6d8cc0761ef7d48d',
                    enabled: true,
                    phoneNumber: '+15005550006',
                });
            expect(customTwilioSettingResponse).to.have.status(200);

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
                const { alertVia, alertStatus, error } = event;
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
        it('should not SMS/Call alerts to on-call teams and subscriber if global and custom twilio settings are removed.', async function() {
            await GlobalConfigModel.deleteMany({ name: 'twilio' });
            const billingEndpointResponse = await request
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

            const newIncident = await createIncident({
                request,
                authorization,
                projectId,
                monitorId,
                payload: {
                    monitorId,
                    projectId,
                    title: 'test monitor  is offline.',
                    incidentType: 'offline',
                    description: 'Incident description',
                },
            });
            expect(newIncident).to.have.status(200);

            const { _id: incidentId } = newIncident.body;

            const incidentResolved = await markIncidentAsResolved({
                request,
                authorization,
                projectId,
                incidentId,
            });

            expect(incidentResolved).to.have.status(200);

            await sleep(10 * 1000);

            const subscribersAlerts = await getSubscribersAlerts({
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

            const eventTypesSent = [];
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

            const onCallAlerts = await getOnCallAlerts({
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
            const alertsSentList = [];
            for (const event of onCallAlerts.body.data) {
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

describe('Email Incident Alerts', function() {
    before(async function() {
        this.timeout(30000);
        const createdUser = await createUser(request, userData.user);
        const project = createdUser.body.project;
        projectId = project._id;
        userId = createdUser.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        const token = verificationToken.token;
        await verifyToken({ request, token });
        const { email, password } = userData.user;
        const userLogin = await login({ request, email, password });
        const jwtToken = userLogin.body.tokens.jwtAccessToken;
        authorization = getAuthorizationHeader({ jwtToken });
        const component = await createComponent({
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
        const monitor = await createMonitor({
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
        const schedule = await createSchedule({
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

    after(async function() {
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
        await VerificationToken.deleteMany({ userId });
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
    it('should not send Email alerts if no SMTP configurations are set.', async function() {
        this.timeout(30000);
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts = await getSubscribersAlerts({
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
        const eventTypesSent = [];
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
            expect(alertVia).to.equal('email');
            expect(error).to.equal(true);
            expect(errorMessage).to.equal(
                'SMTP Settings not found on Admin Dashboard'
            );
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);

        const onCallAlerts = await getOnCallAlerts({
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

        const eventTypesSentToTeamMembers = [];
        for(let onCallAlert of onCallAlerts.body.data){
            const { alertVia, eventType, alertStatus, error, errorMessage } = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal(null);
            expect(error).to.equal(true);
            expect(errorMessage).equal(
                'SMTP Settings not found on Admin Dashboard'
            );
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(true);
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts disabled.
     * Custom SMTP congigurations : not set.
     */
    it('should not send Email alerts if global SMTP configurations are set and email are disabled in global configurations.', async function() {
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
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts = await getSubscribersAlerts({
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
        const eventTypesSent = [];
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
            expect(alertVia).to.equal('email');
            expect(error).to.equal(true);
            expect(errorMessage).to.equal('Alert Disabled on Admin Dashboard');
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts = await getOnCallAlerts({
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

        const eventTypesSentToTeamMembers = [];
        for(let onCallAlert of onCallAlerts.body.data){
            const { alertVia, eventType, alertStatus, error, errorMessage } = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal(null);
            expect(error).to.equal(true);
            expect(errorMessage).equal('Alert Disabled on Admin Dashboard');    
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(true);
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts enabled.
     * Custom SMTP congigurations : not set.
     */
    it('should send Email alerts if global SMTP configurations are set and email are enabled in global configurations.', async function() {
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
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts = await getSubscribersAlerts({
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
        const eventTypesSent = [];
        for (const event of subscribersAlerts.body.data) {
            const { alertStatus, alertVia, eventType, error } = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal('Sent');
            expect(alertVia).to.equal('email');
            expect(error).to.equal(false);
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts = await getOnCallAlerts({
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

        const eventTypesSentToTeamMembers = [];
        for(let onCallAlert of onCallAlerts.body.data){
            const { alertVia, eventType, alertStatus, error, errorMessage } = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal('Success');
            expect(error).to.equal(false);
            expect(errorMessage).to.be.undefined;
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(true);
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts enabled.
     * Custom SMTP configurations : not set.
     * investigation note email notification : not set
     */
    it('should not send statusPageNote(investigation note) Email notification when disabled', async function() {
        this.timeout(30 * 1000);
        // update global smtp settings
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

        // disable status page note (investigation note) Email notification on the project
        const {
            enableInvestigationNoteNotificationEmail,
        } = await ProjectService.updateOneBy(
            { _id: projectId },
            {
                enableInvestigationNoteNotificationEmail: false,
            }
        );

        expect(enableInvestigationNoteNotificationEmail).to.be.false;

        // create an incident
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);

        const incidentId = newIncident.body._id;

        // create a status page note (investigation note)
        const statusPageNotePayload = {
            content: 'this is a test investigation note',
            incident_state: 'update',
            type: 'investigation',
        };

        const newStatusPageNote = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send(statusPageNotePayload);

        expect(newStatusPageNote).to.have.status(200);

        // resolve the incident
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(incidentResolved).to.have.status(200);

        await sleep(10 * 1000);

        const subscriberAlerts = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(subscriberAlerts.body.data).to.be.an('array');

        const statusPageNoteNotificationAlert = subscriberAlerts.body.data.find(
            subscriberAlert =>
                subscriberAlert.alertVia === 'email' &&
                subscriberAlert.errorMessage ===
                    'Investigation Note Email Notification Disabled'
        );
        expect(statusPageNoteNotificationAlert).to.be.an('object');
    });

    /**
     * Global SMTP configurations : set.
     * Email alerts disabled.
     * Custom SMTP congigurations : set.
     */
    it('should send Email alerts if global SMTP configurations are set, email alerts disabled in global configurations, and custom SMTP settings are set.', async function() {
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
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts = await getSubscribersAlerts({
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
        const eventTypesSent = [];
        for (const event of subscribersAlerts.body.data) {
            const { alertStatus, alertVia, eventType, error } = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal('Sent');
            expect(alertVia).to.equal('email');
            expect(error).to.equal(false);
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts = await getOnCallAlerts({
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

        const eventTypesSentToTeamMembers = [];
        for(let onCallAlert of onCallAlerts.body.data){
            const { alertVia, eventType, alertStatus, error, errorMessage } = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal('Success');
            expect(error).to.equal(false);
            expect(errorMessage).to.be.undefined;
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(true);
        await GlobalConfigService.hardDeleteBy({ name: 'smtp' });
        await EmailSmtpService.hardDeleteBy({ projectId });
    });

    /**
     * Global SMTP configurations : not set.
     * Email alerts disabled.
     * Custom SMTP congigurations : set.
     */
    it('should send Email alerts if global SMTP configurations are not set, and custom SMTP settings are set.', async function() {
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
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);
        const { _id: incidentId } = newIncident.body;
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });
        expect(incidentResolved).to.have.status(200);
        await sleep(15 * 1000);
        const subscribersAlerts = await getSubscribersAlerts({
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
        const eventTypesSent = [];
        for (const event of subscribersAlerts.body.data) {
            const { alertStatus, alertVia, eventType, error } = event;
            eventTypesSent.push(eventType);
            expect(alertStatus).to.equal('Sent');
            expect(alertVia).to.equal('email');
            expect(error).to.equal(false);
        }
        expect(eventTypesSent.includes('resolved')).to.equal(true);
        expect(eventTypesSent.includes('identified')).to.equal(true);
        const onCallAlerts = await getOnCallAlerts({
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

        const eventTypesSentToTeamMembers = [];
        for(let onCallAlert of onCallAlerts.body.data){
            const { alertVia, eventType, alertStatus, error, errorMessage } = onCallAlert;
            eventTypesSentToTeamMembers.push(eventType);
            expect(alertVia).to.equal('email');
            expect(alertStatus).to.equal('Success');
            expect(error).to.equal(false);
            expect(errorMessage).to.be.undefined;
        }

        expect(eventTypesSentToTeamMembers.includes('resolved')).to.equal(true);
        expect(eventTypesSentToTeamMembers.includes('identified')).to.equal(true);
        await EmailSmtpService.hardDeleteBy({ projectId });
    });
});

describe('Webhook Incident Alerts', function() {
    this.timeout(30 * 1000);
    before(async function() {
        this.timeout(30000);
        const createdUser = await createUser(request, userData.user);
        const project = createdUser.body.project;
        projectId = project._id;
        userId = createdUser.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        const token = verificationToken.token;
        await verifyToken({ request, token });
        const { email, password } = userData.user;
        const userLogin = await login({ request, email, password });
        const jwtToken = userLogin.body.tokens.jwtAccessToken;
        authorization = getAuthorizationHeader({ jwtToken });
        const component = await createComponent({
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
        const monitor = await createMonitor({
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

        const schedule = await createSchedule({
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

    after(async function() {
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
        await VerificationToken.deleteMany({ userId });
        await LoginIPLog.deleteMany({ userId });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not send statusPageNote(investigation note) Webhook notification when disabled', async () => {
        // disable status page note (investigation note) notification for webhooks
        const {
            enableInvestigationNoteNotificationWebhook,
        } = await ProjectService.updateOneBy(
            { _id: projectId },
            {
                enableInvestigationNoteNotificationWebhook: false,
            }
        );

        expect(enableInvestigationNoteNotificationWebhook).to.be.false;

        // create an incident
        const newIncident = await createIncident({
            request,
            authorization,
            projectId,
            monitorId,
            payload: {
                monitorId,
                projectId,
                title: 'test monitor  is offline.',
                incidentType: 'offline',
                description: 'Incident description',
            },
        });
        expect(newIncident).to.have.status(200);

        const incidentId = newIncident.body._id;

        // create a status page note (investigation note)
        const statusPageNotePayload = {
            content: 'this is a test investigation note',
            incident_state: 'update',
            type: 'investigation',
        };

        const newStatusPageNote = await request
            .post(`/incident/${projectId}/incident/${incidentId}/message`)
            .set('Authorization', authorization)
            .send(statusPageNotePayload);

        expect(newStatusPageNote).to.have.status(200);

        // resolve the incident
        const incidentResolved = await markIncidentAsResolved({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(incidentResolved).to.have.status(200);

        await sleep(10 * 1000);

        const subscriberAlerts = await getSubscribersAlerts({
            request,
            authorization,
            projectId,
            incidentId,
        });

        expect(subscriberAlerts.body.data).to.be.an('array');

        const statusPageNoteNotificationAlert = subscriberAlerts.body.data.find(
            subscriberAlert =>
                subscriberAlert.alertVia === 'webhook' &&
                subscriberAlert.errorMessage ===
                    'Investigation Note Webhook Notification Disabled'
        );
        expect(statusPageNoteNotificationAlert).to.be.an('object');
    });
});
