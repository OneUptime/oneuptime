/* eslint-disable */
process.env.PORT = 3020;
process.env.IS_SAAS_SERVICE = true;
let userData = require('./data/user');
let chai = require('chai');
const expect = require('chai').expect;
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
let app = require('../server');
let GlobalConfig = require('./utils/globalConfig');
let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let GlobalConfigService = require('../backend/services/globalConfigService');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let ComponentService = require('../backend/services/componentService');
let MonitorService = require('../backend/services/monitorService');
let NotificationService = require('../backend/services/notificationService');
let AirtableService = require('../backend/services/airtableService');

let VerificationTokenModel = require('../backend/models/verificationToken');
let UserModel = require('../backend/models/user');
let GlobalConfigModel = require('../backend/models/globalConfig');

const sleep = waitTimeInMs =>
  new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let authorization, token, userId, airtableId, projectId, componentId, monitorId, scheduleId;

describe('Incident Alerts', function () {
  this.timeout(30000);

  before(function (done) {
    this.timeout(30000);
    GlobalConfig.initTestConfig().then(() => {
      createUser(request, userData.user, async function (err, res) {
        let project = res.body.project;
        projectId = project._id;
        userId = res.body.id;
        airtableId = res.body.airtableId;

        await UserModel.updateOne(
          { _id: userId },
          { alertPhoneNumber: '+19173976235' }
        );

        VerificationTokenModel.findOne({ userId }, function (
          err,
          verificationToken
        ) {
          request
            .get(
              `/user/confirmation/${verificationToken.token}`
            )
            .redirects(0)
            .end(function () {
              request
                .post('/user/login')
                .send({
                  email: userData.user.email,
                  password: userData.user.password,
                })
                .end(async function (err, res) {
                  token = res.body.tokens.jwtAccessToken;
                  authorization = `Basic ${token}`;

                  const component = await request
                    .post(`/component/${projectId}`)
                    .set('Authorization', authorization)
                    .send({
                      projectId,
                      name: "test",
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
                      type: "device",
                      name: "test monitor ",
                      data: { deviceId: "abcdef" },
                      deviceId: "abcdef",
                      criteria: {},
                    })
                  monitorId = monitor.body._id;

                  await request
                    .post(`/stripe/${projectId}/addBalance`)
                    .set('Authorization', authorization)
                    .send({ rechargeBalanceAmount: "2000" });

                  await request
                    .post(`/subscriber/${projectId}/subscribe/${monitorId}`)
                    .set('Authorization', authorization)
                    .send({
                      alertVia: "sms",
                      contactPhone: "9173976235",
                      countryCode: "us",
                    });

                  const schedule = await request
                    .post(`/schedule/${projectId}`)
                    .set('Authorization', authorization)
                    .send({ name: "test schedule" })
                  scheduleId = schedule.body._id;

                  await request
                    .put(`/schedule/${projectId}/${scheduleId}`)
                    .set('Authorization', authorization)
                    .send({ monitorIds: [monitorId] });

                  await request
                    .post(`/schedule/${projectId}/${scheduleId}/addescalation`)
                    .set('Authorization', authorization)
                    .send(
                      [{
                        callReminders: "3",
                        smsReminders: "3",
                        emailReminders: "3",
                        email: false,
                        sms: true,
                        call: true,
                        teams: [
                          {
                            teamMembers:
                              [
                                {
                                  member: "",
                                  timezone: "",
                                  startTime: "",
                                  endTime: "",
                                  userId
                                }
                              ]
                          }
                        ]
                      }]
                    );
                  done();
                });
            });
        });

      });
    });
  });

  after(async function () {
    // await GlobalConfig.removeTestConfig();
    // await ComponentService.hardDeleteBy({ projectId });
    // await MonitorService.hardDeleteBy({ projectId });
    // await ProjectService.hardDeleteBy({ _id: projectId });
    // await UserService.hardDeleteBy({ _id: userId });
    // await NotificationService.hardDeleteBy({ projectId: projectId });
    // await AirtableService.deleteUser(airtableId);
  });

  describe('Global twilio credentials set (and Custom twilio settings not set)', async () => {
    /**
     * Global twilio settings: set
     * Custom twilio settings: not set
     * Global twilio settings (SMS/Call) enable : true
     * SMS/Call alerts enabled for the project (billing): true
     */

    it('should send SMS/Call alerts to on-call teams and subscribers if the SMS/Call alerts are enabled globally and for the project.', async function () {
      const globalSettings = await GlobalConfigModel.findOne(
        { name: 'twilio' },
      );
      const { value } = globalSettings;
      value['sms-enabled'] = true;
      value['call-enabled'] = true;
      await GlobalConfigModel.findOneAndUpdate(
        { name: 'twilio' },
        { value },
      );

      const billingEndpointResponse = await request
        .put(`/project/${projectId}/alertOptions`)
        .set('Authorization', authorization)
        .send({
          alertEnable: true,
          billingNonUSCountries: true,
          billingRiskCountries: true,
          billingUS: true,
          minimumBalance: "100",
          rechargeToBalance: "200",
          _id: projectId,
        });
      expect(billingEndpointResponse).to.have.status(200);

      const incidentCreationEndpointResponse = await request
        .post(`/incident/${projectId}/${monitorId}`)
        .set('Authorization', authorization)
        .send({
          monitorId,
          projectId,
          title: "test monitor  is offline.",
          incidentType: "offline",
          description: 'Incident description',
        });
      expect(incidentCreationEndpointResponse).to.have.status(200);

      const { _id: incidentId } = incidentCreationEndpointResponse.body

      const incidentResolveEndpointResponse = await request
        .post(`/incident/${projectId}/resolve/${incidentId}`)
        .set('Authorization', authorization);

      expect(incidentResolveEndpointResponse).to.have.status(200);

      await sleep(10 * 1000);

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(subscribersAlertsEndpointReponse).to.have.status(200);
      expect(subscribersAlertsEndpointReponse.body).to.an('object');
      expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
      expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
      expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(2);

      const eventTypesSent = []
      for (const event of subscribersAlertsEndpointReponse.body.data) {
        const { alertStatus, alertVia, eventType, error, errorMessage } = event;
        eventTypesSent.push(eventType);
        expect(alertStatus).to.equal('Success');
        expect(alertVia).to.equal('sms');
        expect(error).to.equal(false);
        expect(errorMessage).to.equal(undefined);
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
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
        expect(error).to.equal(false)
        alertsSentList.push(alertVia)
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
    it('should not send Call alerts to on-call teams if the Call alerts are disabled in the global twilio configurations.', async function () {
      const globalSettings = await GlobalConfigModel.findOne(
        { name: 'twilio' },
      );
      const { value } = globalSettings;
      value['sms-enabled'] = true;
      value['call-enabled'] = false;
      await GlobalConfigModel.findOneAndUpdate(
        { name: 'twilio' },
        { value },
      );

      const billingEndpointResponse = await request
        .put(`/project/${projectId}/alertOptions`)
        .set('Authorization', authorization)
        .send({
          alertEnable: true,
          billingNonUSCountries: true,
          billingRiskCountries: true,
          billingUS: true,
          minimumBalance: "100",
          rechargeToBalance: "200",
          _id: projectId,
        });
      expect(billingEndpointResponse).to.have.status(200);

      const incidentCreationEndpointResponse = await request
        .post(`/incident/${projectId}/${monitorId}`)
        .set('Authorization', authorization)
        .send({
          monitorId,
          projectId,
          title: "test monitor  is offline.",
          incidentType: "offline",
          description: 'Incident description',
        });
      expect(incidentCreationEndpointResponse).to.have.status(200);

      const { _id: incidentId } = incidentCreationEndpointResponse.body

      const incidentResolveEndpointResponse = await request
        .post(`/incident/${projectId}/resolve/${incidentId}`)
        .set('Authorization', authorization);

      expect(incidentResolveEndpointResponse).to.have.status(200);

      await sleep(10 * 1000);

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(subscribersAlertsEndpointReponse).to.have.status(200);
      expect(subscribersAlertsEndpointReponse.body).to.an('object');
      expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
      expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
      expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(2);

      const eventTypesSent = []
      for (const event of subscribersAlertsEndpointReponse.body.data) {
        const { alertStatus, alertVia, eventType, error, errorMessage } = event;
        eventTypesSent.push(eventType);
        expect(alertStatus).to.equal('Success');
        expect(alertVia).to.equal('sms');
        expect(error).to.equal(false);
        expect(errorMessage).to.equal(undefined);
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(oncallAlertsEndpointReponse).to.have.status(200);
      expect(oncallAlertsEndpointReponse.body).to.an('object');
      expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
      expect(oncallAlertsEndpointReponse.body.data).to.an('array');
      expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
      const alertsSentList = [];
      for (const event of oncallAlertsEndpointReponse.body.data) {
        const { alertVia, alertStatus, error } = event;
        if (alertVia === 'sms') {
          expect(alertStatus).to.equal('Success');
          expect(error).to.equal(false)
        }
        else if (alertVia === 'call') {
          expect(alertStatus).to.equal(null);
          expect(error).to.equal(true)
        }
        alertsSentList.push(alertVia)
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
    it('should not send SMS alerts to on-call teams and subscriber if the SMS alerts are disabled in the global twilio configurations.', async function () {
      const globalSettings = await GlobalConfigModel.findOne(
        { name: 'twilio' },
      );
      const { value } = globalSettings;
      value['sms-enabled'] = false;
      value['call-enabled'] = true;
      await GlobalConfigModel.findOneAndUpdate(
        { name: 'twilio' },
        { value },
      );

      const billingEndpointResponse = await request
        .put(`/project/${projectId}/alertOptions`)
        .set('Authorization', authorization)
        .send({
          alertEnable: true,
          billingNonUSCountries: true,
          billingRiskCountries: true,
          billingUS: true,
          minimumBalance: "100",
          rechargeToBalance: "200",
          _id: projectId,
        });
      expect(billingEndpointResponse).to.have.status(200);

      const incidentCreationEndpointResponse = await request
        .post(`/incident/${projectId}/${monitorId}`)
        .set('Authorization', authorization)
        .send({
          monitorId,
          projectId,
          title: "test monitor  is offline.",
          incidentType: "offline",
          description: 'Incident description',
        });
      expect(incidentCreationEndpointResponse).to.have.status(200);

      const { _id: incidentId } = incidentCreationEndpointResponse.body

      const incidentResolveEndpointResponse = await request
        .post(`/incident/${projectId}/resolve/${incidentId}`)
        .set('Authorization', authorization);

      expect(incidentResolveEndpointResponse).to.have.status(200);

      await sleep(10 * 1000);

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(subscribersAlertsEndpointReponse).to.have.status(200);
      expect(subscribersAlertsEndpointReponse.body).to.an('object');
      expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
      expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
      expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(2);

      const eventTypesSent = []
      for (const event of subscribersAlertsEndpointReponse.body.data) {
        const { alertStatus, alertVia, eventType, error, errorMessage } = event;
        eventTypesSent.push(eventType);
        expect(alertStatus).to.equal(null);
        expect(alertVia).to.equal('sms');
        expect(error).to.equal(true);
        expect(errorMessage).to.equal('SMS Not Enabled');
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(oncallAlertsEndpointReponse).to.have.status(200);
      expect(oncallAlertsEndpointReponse.body).to.an('object');
      expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
      expect(oncallAlertsEndpointReponse.body.data).to.an('array');
      expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
      const alertsSentList = [];
      for (const event of oncallAlertsEndpointReponse.body.data) {
        const { alertVia, alertStatus, error } = event;
        if (alertVia === 'call') {
          expect(alertStatus).to.equal('Success');
          expect(error).to.equal(false)
        }
        else if (alertVia === 'sms') {
          expect(alertStatus).to.equal(null);
          expect(error).to.equal(true)
        }
        alertsSentList.push(alertVia)
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
    it('should not send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled for the project (billing).', async function () {
      const globalSettings = await GlobalConfigModel.findOne(
        { name: 'twilio' },
      );
      const { value } = globalSettings;
      value['sms-enabled'] = true;
      value['call-enabled'] = true;
      await GlobalConfigModel.findOneAndUpdate(
        { name: 'twilio' },
        { value },
      );

      const billingEndpointResponse = await request
        .put(`/project/${projectId}/alertOptions`)
        .set('Authorization', authorization)
        .send({
          alertEnable: false,
          billingNonUSCountries: true,
          billingRiskCountries: true,
          billingUS: true,
          minimumBalance: "100",
          rechargeToBalance: "200",
          _id: projectId,
        });
      expect(billingEndpointResponse).to.have.status(200);

      const incidentCreationEndpointResponse = await request
        .post(`/incident/${projectId}/${monitorId}`)
        .set('Authorization', authorization)
        .send({
          monitorId,
          projectId,
          title: "test monitor  is offline.",
          incidentType: "offline",
          description: 'Incident description',
        });
      expect(incidentCreationEndpointResponse).to.have.status(200);

      const { _id: incidentId } = incidentCreationEndpointResponse.body

      const incidentResolveEndpointResponse = await request
        .post(`/incident/${projectId}/resolve/${incidentId}`)
        .set('Authorization', authorization);

      expect(incidentResolveEndpointResponse).to.have.status(200);

      await sleep(10 * 1000);

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(subscribersAlertsEndpointReponse).to.have.status(200);
      expect(subscribersAlertsEndpointReponse.body).to.an('object');
      expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
      expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
      expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(2);

      const eventTypesSent = []
      for (const event of subscribersAlertsEndpointReponse.body.data) {
        const { alertStatus, alertVia, eventType, error, errorMessage } = event;
        eventTypesSent.push(eventType);
        expect(alertStatus).to.equal(null);
        expect(alertVia).to.equal('sms');
        expect(error).to.equal(true);
        expect(errorMessage).to.equal('Alert Disabled');
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(oncallAlertsEndpointReponse).to.have.status(200);
      expect(oncallAlertsEndpointReponse.body).to.an('object');
      expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
      expect(oncallAlertsEndpointReponse.body.data).to.an('array');
      expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
      const alertsSentList = [];
      for (const event of oncallAlertsEndpointReponse.body.data) {
        const { alertVia, alertStatus, error } = event;
        expect(alertStatus).to.equal('Alerts Disabled');
        expect(error).to.equal(true)
        alertsSentList.push(alertVia)
      }
      expect(alertsSentList.includes('sms')).to.equal(true);
      expect(alertsSentList.includes('call')).to.equal(true);
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
    it('should send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled for the project (billing).', async function () {
      const globalSettings = await GlobalConfigModel.findOne(
        { name: 'twilio' },
      );
      const { value } = globalSettings;
      value['sms-enabled'] = true;
      value['call-enabled'] = true;
      await GlobalConfigModel.findOneAndUpdate(
        { name: 'twilio' },
        { value },
      );
      const billingEndpointResponse = await request
        .put(`/project/${projectId}/alertOptions`)
        .set('Authorization', authorization)
        .send({
          alertEnable: false,
          billingNonUSCountries: true,
          billingRiskCountries: true,
          billingUS: true,
          minimumBalance: "100",
          rechargeToBalance: "200",
          _id: projectId,
        });
      expect(billingEndpointResponse).to.have.status(200);

      const customTwilioSettingResponse = await request
        .post(`/smsSmtp/${projectId}`)
        .set('Authorization', authorization)
        .send({
          accountSid: "AC4b957669470069d68cd5a09d7f91d7c6",
          authToken: "79a35156d9967f0f6d8cc0761ef7d48d",
          enabled: true,
          phoneNumber: "+15005550006",
        });
      expect(customTwilioSettingResponse).to.have.status(200);

      const incidentCreationEndpointResponse = await request
        .post(`/incident/${projectId}/${monitorId}`)
        .set('Authorization', authorization)
        .send({
          monitorId,
          projectId,
          title: "test monitor  is offline.",
          incidentType: "offline",
          description: 'Incident description',
        });
      expect(incidentCreationEndpointResponse).to.have.status(200);

      const { _id: incidentId } = incidentCreationEndpointResponse.body

      const incidentResolveEndpointResponse = await request
        .post(`/incident/${projectId}/resolve/${incidentId}`)
        .set('Authorization', authorization);

      expect(incidentResolveEndpointResponse).to.have.status(200);

      await sleep(10 * 1000);

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(subscribersAlertsEndpointReponse).to.have.status(200);
      expect(subscribersAlertsEndpointReponse.body).to.an('object');
      expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
      expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
      expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(2);

      const eventTypesSent = []
      for (const event of subscribersAlertsEndpointReponse.body.data) {
        const { alertStatus, alertVia, eventType, error, errorMessage } = event;
        eventTypesSent.push(eventType);
        expect(alertStatus).to.equal('Success');
        expect(alertVia).to.equal('sms');
        expect(error).to.equal(false);
        expect(errorMessage).to.equal(undefined);
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
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
        expect(error).to.equal(false)
        alertsSentList.push(alertVia)
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
    it('should send SMS/Call alerts to on-call teams and subscriber if the alerts are disabled in the global twilio settings.', async function () {
      const globalSettings = await GlobalConfigModel.findOne(
        { name: 'twilio' },
      );
      const { value } = globalSettings;
      value['sms-enabled'] = false;
      value['call-enabled'] = false;
      await GlobalConfigModel.findOneAndUpdate(
        { name: 'twilio' },
        { value },
      );
      const billingEndpointResponse = await request
        .put(`/project/${projectId}/alertOptions`)
        .set('Authorization', authorization)
        .send({
          alertEnable: false,
          billingNonUSCountries: true,
          billingRiskCountries: true,
          billingUS: true,
          minimumBalance: "100",
          rechargeToBalance: "200",
          _id: projectId,
        });
      expect(billingEndpointResponse).to.have.status(200);

      const customTwilioSettingResponse = await request
        .post(`/smsSmtp/${projectId}`)
        .set('Authorization', authorization)
        .send({
          accountSid: "AC4b957669470069d68cd5a09d7f91d7c6",
          authToken: "79a35156d9967f0f6d8cc0761ef7d48d",
          enabled: true,
          phoneNumber: "+15005550006",
        });
      expect(customTwilioSettingResponse).to.have.status(200);

      const incidentCreationEndpointResponse = await request
        .post(`/incident/${projectId}/${monitorId}`)
        .set('Authorization', authorization)
        .send({
          monitorId,
          projectId,
          title: "test monitor  is offline.",
          incidentType: "offline",
          description: 'Incident description',
        });
      expect(incidentCreationEndpointResponse).to.have.status(200);

      const { _id: incidentId } = incidentCreationEndpointResponse.body

      const incidentResolveEndpointResponse = await request
        .post(`/incident/${projectId}/resolve/${incidentId}`)
        .set('Authorization', authorization);

      expect(incidentResolveEndpointResponse).to.have.status(200);

      await sleep(10 * 1000);

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(subscribersAlertsEndpointReponse).to.have.status(200);
      expect(subscribersAlertsEndpointReponse.body).to.an('object');
      expect(subscribersAlertsEndpointReponse.body.count).to.equal(2);
      expect(subscribersAlertsEndpointReponse.body.data).to.an('array');
      expect(subscribersAlertsEndpointReponse.body.data.length).to.equal(2);

      const eventTypesSent = []
      for (const event of subscribersAlertsEndpointReponse.body.data) {
        const { alertStatus, alertVia, eventType, error, errorMessage } = event;
        eventTypesSent.push(eventType);
        expect(alertStatus).to.equal('Success');
        expect(alertVia).to.equal('sms');
        expect(error).to.equal(false);
        expect(errorMessage).to.equal(undefined);
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${incidentId}?skip=0&limit=999`)
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
        expect(error).to.equal(false)
        alertsSentList.push(alertVia)
      }
      expect(alertsSentList.includes('sms')).to.equal(true);
      expect(alertsSentList.includes('call')).to.equal(true);
    });
  });
});