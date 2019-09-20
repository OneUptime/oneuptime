process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');
let request = chai.request.agent(app);

var incidentData = require('./data/incident');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var IncidentService = require('../backend/services/incidentService');
var MonitorService = require('../backend/services/monitorService');
var NotificationService = require('../backend/services/notificationService');
var SubscriberAlertService = require('../backend/services/subscriberAlertService');
var SubscriberService = require('../backend/services/subscriberService');
var VerificationTokenModel = require('../backend/models/verificationToken');

var token, userId, projectId, monitorId, incidentId, subscriberId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

describe('Subcriber Alert API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            projectId = res.body.project._id;
            userId = res.body.id;
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

    after(async () => {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await SubscriberService.hardDeleteBy({ projectId: projectId });
    });

    it('should create subscriber alert with valid incidentId, alertVia', (done) => {
        request.post(`/subscriber/${projectId}`).send({
            monitorId: monitorId,
            contactEmail: userData.user.email,
            contactPhone: '+23482348294'
        }).end((err, res) => {
            subscriberId = res.body._id;
            request.post(`/subscriberAlert/${projectId}/${subscriberId}`).send({
                incidentId: incidentId,
                alertVia: 'sms'
            }).end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.alertVia).to.be.equal('sms');
                SubscriberAlertService.hardDeleteBy({ _id: res.body._id });
                done();
            });
        });
    });

    it('should not create subscriber alert with invalid alertVia', (done) => {
        request.post(`/subscriber/${projectId}`).send({
            monitorId: monitorId,
            contactEmail: userData.user.email,
            contactPhone: '+23482348294'
        }).end((err, res) => {
            subscriberId = res.body._id;
            request.post(`/subscriberAlert/${projectId}/${subscriberId}`).send({
                incidentId: incidentId,
                alertVia: null
            }).end((err, res) => {
                expect(res).to.have.status(400);
                done();
            });
        });
    });

    it('should get subscriber alerts by projectId', (done) => {
        request.get(`/subscriberAlert/${projectId}`).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get subscriber alerts by incidentId', (done) => {
        request.get(`/subscriberAlert/${projectId}/incident/${incidentId}`).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });
});