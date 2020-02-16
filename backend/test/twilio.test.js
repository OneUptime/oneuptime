process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');

let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let incidentData = require('./data/incident');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let IncidentService = require('../backend/services/incidentService');
let MonitorService = require('../backend/services/monitorService');
let NotificationService = require('../backend/services/notificationService');
let AirtableService = require('../backend/services/airtableService');

const baseApiUrl = process.env.BACKEND_HOST;
let VerificationTokenModel = require('../backend/models/verificationToken');
let TwilioConfig = require('../backend/config/twilio');

let token, userId, airtableId, projectId, monitorId, incidentId, monitor = {
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
                        let authorization = `Basic ${token}`;
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
        let authorization = `Basic ${token}`;
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