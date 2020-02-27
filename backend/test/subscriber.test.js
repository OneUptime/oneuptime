process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');

const UserService = require('../backend/services/userService');
const StatusPageService = require('../backend/services/statusPageService');
const ProjectService = require('../backend/services/projectService');
const NotificationService = require('../backend/services/notificationService');
const SubscriberService = require('../backend/services/subscriberService');
const MonitorService = require('../backend/services/monitorService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

let projectId, userId, airtableId, monitorId, token, subscriberId, statusPageId;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Subscriber API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            projectId = res.body.project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function(
                err,
                verificationToken
            ) {
                request
                    .get(`/user/confirmation/${verificationToken.token}`)
                    .redirects(0)
                    .end(function() {
                        request
                            .post('/user/login')
                            .send({
                                email: userData.user.email,
                                password: userData.user.password,
                            })
                            .end(function(err, res) {
                                token = res.body.tokens.jwtAccessToken;
                                const authorization = `Basic ${token}`;
                                request
                                    .post(`/monitor/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send(monitor)
                                    .end(function(err, res) {
                                        monitorId = res.body._id;
                                        expect(res.body.name).to.be.equal(
                                            monitor.name
                                        );
                                        request
                                            .post(`/statusPage/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                links: [],
                                                title: 'Status title',
                                                description:
                                                    'status description',
                                                copyright: 'status copyright',
                                                projectId,
                                                monitorIds: [monitorId],
                                            })
                                            .end(function(err, res) {
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
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await StatusPageService.hardDeleteBy({ projectId: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await SubscriberService.hardDeleteBy({ projectId: projectId });
        await MonitorService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should register subscriber with valid monitorIds and contact email or phone number', done => {
        request
            .post(`/subscriber/${projectId}/${statusPageId}`)
            .send({
                monitors: [monitorId],
                userDetails: {
                    email: userData.user.email,
                    phone_number: userData.user.companyPhoneNumber,
                    country: '+234',
                    method: 'email',
                },
            })
            .end((err, res) => {
                subscriberId = res.body[0]._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0].contactEmail).to.be.equal(
                    userData.user.email
                );
                done();
            });
    });

    it('should not register subscriber without contact email or phone number', done => {
        request
            .post(`/subscriber/${projectId}/${statusPageId}`)
            .send({
                monitorIds: monitorId,
            })
            .end((err, res) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get list of subscribers to a project', done => {
        request.get(`/subscriber/${projectId}`).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get list of subscribers to a monitorId', done => {
        request
            .get(`/subscriber/${projectId}/monitor/${monitorId}`)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get a subscriber', done => {
        request
            .get(`/subscriber/${projectId}/${subscriberId}`)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should delete a subscriber', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/subscriber/${projectId}/${subscriberId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
