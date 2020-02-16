process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');
var incidentData = require('./data/incident');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var IncidentService = require('../backend/services/incidentService');
var MonitorService = require('../backend/services/monitorService');
var NotificationService = require('../backend/services/notificationService');
var AirtableService = require('../backend/services/airtableService');

const baseApiUrl = process.env.BACKEND_HOST;
var VerificationTokenModel = require('../backend/models/verificationToken');
var TwilioConfig = require('../backend/config/twilio');

var token, userId, airtableId, projectId, monitorId, incidentId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

describe('Twilio API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function (err, res) {
            projectId = res.body.project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        var authorization = `Basic ${token}`;
                        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                            monitorId = res.body._id;
                            request.post(`/incident/${projectId}/${monitorId}`).set('Authorization', authorization)
                                .send(incidentData).end((err, res) => {
                                    incidentId = res.body._id;
                                    expect(res).to.have.status(200);
                                    expect(res.body).to.be.an('object');
                                    done();
                                });
                        });
                    });
                });
            });
        });
    });


    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });


    it('should send verification sms code for adding alert phone number', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/twilio/sms/sendVerificationToken?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                to: TwilioConfig.testphoneNumber
            })
            .end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

});