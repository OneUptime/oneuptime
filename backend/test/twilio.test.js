/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const incidentData = require('./data/incident');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const IncidentService = require('../backend/services/incidentService');
const MonitorService = require('../backend/services/monitorService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');
const GlobalConfigService = require('../backend/services/globalConfigService');
const VerificationTokenModel = require('../backend/models/verificationToken');
const { testphoneNumber } = require('./utils/config');
const GlobalConfig = require('./utils/globalConfig');

let token, userId, airtableId, projectId, monitorId;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Twilio API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, async function(err, res) {
                projectId = res.body.project._id;
                userId = res.body.id;
                airtableId = res.body.airtableId;

                // make created user master admin
                await UserService.updateBy(
                    { email: userData.user.email },
                    { role: 'master-admin' }
                );

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
                                            request
                                                .post(
                                                    `/incident/${projectId}/${monitorId}`
                                                )
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send(incidentData)
                                                .end((err, res) => {
                                                    expect(res).to.have.status(
                                                        200
                                                    );
                                                    expect(res.body).to.be.an(
                                                        'object'
                                                    );
                                                    done();
                                                });
                                        });
                                });
                        });
                });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should send verification sms code for adding alert phone number', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/twilio/sms/sendVerificationToken?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                to: testphoneNumber,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should send test sms to the provided phone number', done => {
        const authorization = `Basic ${token}`;

        GlobalConfigService.findOneBy({ name: 'twilio' }).then(({ value }) => {
            const payload = {
                accountSid: value['account-sid'],
                authToken: value['authentication-token'],
                phoneNumber: value.phone,
                testphoneNumber,
            };

            request
                .post('/twilio/sms/test')
                .set('Authorization', authorization)
                .send(payload)
                .end((err, res) => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('message');
                    done();
                });
        });
    });

    it('should return status code 400 when any of the payload field is missing', done => {
        const authorization = `Basic ${token}`;

        GlobalConfigService.findOneBy({ name: 'twilio' }).then(({ value }) => {
            const payload = {
                accountSid: value['account-sid'],
                authToken: value['authentication-token'],
                phoneNumber: value.phone,
                testphoneNumber: '',
            };

            request
                .post('/twilio/sms/test')
                .set('Authorization', authorization)
                .send(payload)
                .end((err, res) => {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    it('should return status code 500 (server error) when accountSid is invalid', done => {
        const authorization = `Basic ${token}`;

        GlobalConfigService.findOneBy({ name: 'twilio' }).then(({ value }) => {
            value['account-sid'] = 'xxuerandomsid';
            const payload = {
                accountSid: value['account-sid'],
                authToken: value['authentication-token'],
                phoneNumber: value.phone,
                testphoneNumber,
            };

            request
                .post('/twilio/sms/test')
                .set('Authorization', authorization)
                .send(payload)
                .end((err, res) => {
                    expect(res).to.have.status(500);
                    done();
                });
        });
    });

    it('should return status code 400 when authToken is invalid', done => {
        const authorization = `Basic ${token}`;

        GlobalConfigService.findOneBy({ name: 'twilio' }).then(({ value }) => {
            value['authentication-token'] = 'xxuerandomsid';
            const payload = {
                accountSid: value['account-sid'],
                authToken: value['authentication-token'],
                phoneNumber: value.phone,
                testphoneNumber,
            };

            request
                .post('/twilio/sms/test')
                .set('Authorization', authorization)
                .send(payload)
                .end((err, res) => {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });
});
