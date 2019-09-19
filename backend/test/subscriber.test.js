
process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');
let request = chai.request.agent(app);

let UserService = require('../backend/services/userService');
let StatusPageService = require('../backend/services/statusPageService');
let ProjectService = require('../backend/services/projectService');
let NotificationService = require('../backend/services/notificationService');
let SubscriberService = require('../backend/services/subscriberService');
let MonitorService = require('../backend/services/monitorService');
var VerificationTokenModel = require('../backend/models/verificationToken');

let projectId, userId, monitorId, token, subscriberId, statusPageId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

describe('Subscriber API', function () {
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
                            expect(res.body.name).to.be.equal(monitor.name);
                            request.post(`/statusPage/${projectId}`).set('Authorization', authorization)
                                .send({
                                    links: [],
                                    title: 'Status title',
                                    description: 'status description',
                                    copyright: 'status copyright',
                                    projectId,
                                    monitorIds: [monitorId]
                                }).end(function (err, res) {
                                    statusPageId = res.body._id;
                                    expect(res).to.have.status(200);
                                    done();
                                });
                        });
                    });
                });
            });
        });
    });

    after(async () => {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await StatusPageService.hardDeleteBy({ projectId: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await SubscriberService.hardDeleteBy({ projectId: projectId });
        await MonitorService.hardDeleteBy({ projectId: projectId });
    });

    it('should register subscriber with valid monitorIds and contact email or phone number', (done) => {
        request.post(`/subscriber/${projectId}/${statusPageId}`).send({
            monitors: [monitorId],
            userDetails: {
                email: userData.user.email,
                phone_number: userData.user.companyPhoneNumber,
                country: '+234',
                method: 'email',
            },
        }).end((err, res) => {
            subscriberId = res.body[0]._id;
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('array');
            expect(res.body[0].contactEmail).to.be.equal(userData.user.email);
            done();
        });
    });

    it('should not register subscriber without contact email or phone number', (done) => {
        request.post(`/subscriber/${projectId}/${statusPageId}`).send({
            monitorIds: monitorId
        }).end((err, res) => {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should get list of subscribers to a project', (done) => {
        request.get(`/subscriber/${projectId}`).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get list of subscribers to a monitorId', (done) => {
        request.get(`/subscriber/${projectId}/monitor/${monitorId}`).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get a subscriber', (done) => {
        request.get(`/subscriber/${projectId}/${subscriberId}`).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should delete a subscriber', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/subscriber/${projectId}/${subscriberId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });
});
