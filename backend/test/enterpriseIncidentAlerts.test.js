/* eslint-disable */
process.env.PORT = 3020;
let userData = require('./data/user');
let chai = require('chai');
const expect = require('chai').expect;
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
let app = require('../server');
let GlobalConfig = require('./utils/globalConfig');
let request = chai.request.agent(app);
let { createEnterpriseUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let ComponentService = require('../backend/services/componentService');
let MonitorService = require('../backend/services/monitorService');
let NotificationService = require('../backend/services/notificationService');
let OnCallScheduleStatusService = require('../backend/services/onCallScheduleStatusService');
let SubscriberService = require('../backend/services/subscriberService');
let SubscriberAlertService = require('../backend/services/subscriberAlertService');
let ScheduleService = require('../backend/services/scheduleService');
let EscalationService = require('../backend/services/escalationService');
let MonitorStatusModel = require('../backend/models/monitorStatus');
let IncidentService = require('../backend/services/incidentService');
let IncidentSMSActionModel = require('../backend/models/incidentSMSAction');
let IncidentPriorityModel = require('../backend/models/incidentPriority');
let IncidentMessageModel = require('../backend/models/incidentMessage');
let IncidentTimelineModel = require('../backend/models/incidentTimeline');
let AlertService = require('../backend/services/alertService');
let AlertChargeModel = require('../backend/models/alertCharge');
let TwilioModel = require('../backend/models/twilio');
let VerificationToken = require('../backend/models/verificationToken');
let LoginIPLog = require('../backend/models/loginIPLog');

let UserModel = require('../backend/models/user');
let GlobalConfigModel = require('../backend/models/globalConfig');

const sleep = waitTimeInMs =>
  new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let authorization, token, userId, projectId, componentId, monitorId, scheduleId;

describe('Incident Alerts', function () {
  this.timeout(30000);

  before(function (done) {
    this.timeout(30000);
    GlobalConfig.initTestConfig().then(() => {
      createEnterpriseUser(request, userData.user, async function (err, res) {
        let project = res.body.project;
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
                      type: "ip",
                      name: "test monitor ",
                      data: { IPAddress: "216.58.223.196" }, // www.google.com
                     // deviceId: "abcdef", IOT device has been replaced with IP
                      criteria: {},
                    })
                  monitorId = monitor.body._id;

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

  after(async function () {
    await GlobalConfig.removeTestConfig();
    await OnCallScheduleStatusService.hardDeleteBy({project:projectId});
    await SubscriberService.hardDeleteBy({projectId});
    await SubscriberAlertService.hardDeleteBy({projectId});
    await ScheduleService.hardDeleteBy({projectId});
    await EscalationService.hardDeleteBy({projectId});
    await IncidentService.hardDeleteBy({projectId});
    await AlertService.hardDeleteBy({projectId});
    await MonitorStatusModel.deleteMany({monitorId});
    await IncidentSMSActionModel.deleteMany({userId});
    await IncidentPriorityModel.deleteMany({projectId});
    await AlertChargeModel.deleteMany({projectId});
    await TwilioModel.deleteMany({projectId});
    await IncidentMessageModel.deleteMany({createdById:userId})
    await IncidentTimelineModel.deleteMany({createdById:userId});
    await VerificationToken.deleteMany({userId});
    await LoginIPLog.deleteMany({userId});
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

    it('should send SMS/Call alerts to on-call teams and subscribers if the SMS/Call alerts are enabled globally.', async function () {
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

      // idNumber is what is been used to query subscriber and onCall
      // The idNumber is gotten from the schema of the database
      const idNumber = incidentResolveEndpointResponse.body.incident.idNumber;

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
        .get(`/alert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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

      // idNumber is what is been used to query subscriber and onCall
      // The idNumber is gotten from the schema of the database
      const idNumber = incidentResolveEndpointResponse.body.incident.idNumber;

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
        .get(`/alert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
          expect(error).to.equal(false)
        }
        else if (alertVia === 'call') {
          expect(alertStatus).to.equal(null);
          expect(error).to.equal(true);
          expect(errorMessage).to.equal('Alert Disabled on Admin Dashboard');
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

      // idNumber is what is been used to query subscriber and onCall
      // The idNumber is gotten from the schema of the database
      const idNumber = incidentResolveEndpointResponse.body.incident.idNumber;

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
        expect(errorMessage).to.equal('Alert Disabled on Admin Dashboard');
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);

      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
        .set('Authorization', authorization);

      expect(oncallAlertsEndpointReponse).to.have.status(200);
      expect(oncallAlertsEndpointReponse.body).to.an('object');
      expect(oncallAlertsEndpointReponse.body.count).to.equal(2);
      expect(oncallAlertsEndpointReponse.body.data).to.an('array');
      expect(oncallAlertsEndpointReponse.body.data.length).to.equal(2);
      const alertsSentList = [];
      for (const event of oncallAlertsEndpointReponse.body.data) {
        const { alertVia, alertStatus, error,errorMessage } = event;
        if (alertVia === 'call') {
          expect(alertStatus).to.equal('Success');
          expect(error).to.equal(false)
        }
        else if (alertVia === 'sms') {
          expect(alertStatus).to.equal(null);
          expect(error).to.equal(true)
          expect(errorMessage).to.equal('Alert Disabled on Admin Dashboard')          
        }
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
     * Global twilio settings SMS enable : false
     * Global twilio settings Call enable : false
     */
    it('should send SMS/Call alerts to on-call teams and subscriber even if the alerts are disabled in the global twilio settings.', async function () {
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

      // idNumber is what is been used to query subscriber and onCall
      // The idNumber is gotten from the schema of the database
      const idNumber = incidentResolveEndpointResponse.body.incident.idNumber;

      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
        .get(`/alert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
     * Global twilio settings: not set
     * Custom twilio settings: not set
     */
    it('should not SMS/Call alerts to on-call teams and subscriber if global and custom twilio settings are removed.', async function () {
      const globalSettings = await GlobalConfigModel.deleteMany(
        { name: 'twilio' },
      );
  
      const getCustomTwilioSettingResponse = await request
        .get(`/smsSmtp/${projectId}/`)
        .set('Authorization', authorization);
      expect(getCustomTwilioSettingResponse).to.have.status(200);
      expect(getCustomTwilioSettingResponse.body).to.be.an('object');
  
      const {_id:smsSmtpId} = getCustomTwilioSettingResponse.body;
  
      if(smsSmtpId){
        const deleteCustomTwilioSettingResponse = await request
            .delete(`/smsSmtp/${projectId}/${smsSmtpId}`)
            .set('Authorization', authorization);
        expect(deleteCustomTwilioSettingResponse).to.have.status(200);
      }
  
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

      // idNumber is what is been used to query subscriber and onCall
      // The idNumber is gotten from the schema of the database
      const idNumber = incidentResolveEndpointResponse.body.incident.idNumber;
  
      const subscribersAlertsEndpointReponse = await request
        .get(`/subscriberAlert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
        expect(errorMessage).to.equal('Twilio Settings not found on Admin Dashboard');
      }
      expect(eventTypesSent.includes('resolved')).to.equal(true);
      expect(eventTypesSent.includes('identified')).to.equal(true);
  
      const oncallAlertsEndpointReponse = await request
        .get(`/alert/${projectId}/incident/${idNumber}?skip=0&limit=999`)
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
        expect(errorMessage).to.equal('Twilio Settings not found on Admin Dashboard');
        alertsSentList.push(alertVia);
      }
      expect(alertsSentList.includes('sms')).to.equal(true);
      expect(alertsSentList.includes('call')).to.equal(true);
    });
  });
});