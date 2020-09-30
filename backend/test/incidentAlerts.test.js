/* eslint-disable */
process.env.PORT = 3020;
process.env.IS_SAAS_SERVICE = true;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
let app = require('../server');
let GlobalConfig = require('./utils/globalConfig');
let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let ComponentService = require('../backend/services/componentService');
let MonitorService = require('../backend/services/monitorService');
let NotificationService = require('../backend/services/notificationService');
let AirtableService = require('../backend/services/airtableService');

let VerificationTokenModel = require('../backend/models/verificationToken');
let UserModel = require('../backend/models/user');

let authorization, token, userId, airtableId, projectId, componentId, monitorId, scheduleId;

describe('Monitor API', function () {
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
                    .send({monitorIds:[monitorId]});
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
                    )

                  done();
                });
            });
        });

      });
    });
  });

  after(async function () {
    await GlobalConfig.removeTestConfig();
    await ComponentService.hardDeleteBy({ projectId });
    await MonitorService.hardDeleteBy({ projectId });
    await ProjectService.hardDeleteBy({ _id: projectId });
    await UserService.hardDeleteBy({ _id: userId });
    await NotificationService.hardDeleteBy({ projectId: projectId });
    await AirtableService.deleteUser(airtableId);
  });

});