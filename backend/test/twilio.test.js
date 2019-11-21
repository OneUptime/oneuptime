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

var baseApiUrl = require('../backend/config/baseApiUrl');
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
        createUser(request, userData.user, function(err, res) {
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
                            monitorId = res.body[0]._id;
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

    it('should get a message response', function (done) {
        request.get('/twilio/voice/incident').send().end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });

    it('should acknowledge an incident', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/twilio/voice/incident/action?projectId=${projectId}&incidentId=${incidentId}&accessToken=${authorization}`).send({
            Digits: '1'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.text).to.includes('The incident status has been acknowledged. Press 2 to resolve this incident');
            done();
        });
    });

    it('should repeat if wrong key is entered', function (done) {
        var authorization = `Basic ${token}`;
        let actionPath = `${baseApiUrl}/twilio/voice/incident/action?projectId=${projectId}&amp;incidentId=${incidentId}&amp;accessToken=${authorization}`;
        request.post(`/twilio/voice/incident/action?projectId=${projectId}&incidentId=${incidentId}&accessToken=${authorization}`).send({
            Digits: '5'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.text).to.eql(`<Response><Gather numDigits="1" input="dtmf" action="${actionPath}" timeout="15"><Say voice="alice">You have pressed unknown key, Please press 1 to acknowledge or 2 to resolve the incident.</Say></Gather><Say voice="alice">No response received. This call will end.</Say><Hangup /></Response>`);
            done();
        });
    });

    it('should resolve an incident', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/twilio/voice/incident/action?projectId=${projectId}&incidentId=${incidentId}&accessToken=${authorization}`).send({
            Digits: '2'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.text).to.eql('<Response><Say voice="alice">The incident status has been resolved. Log on to your dashboard to see the status. Thank you for using Fyipe.</Say><Hangup /></Response>');
            done();
        });
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