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
const VerificationTokenModel = require('../backend/models/verificationToken');
const Config = require('./utils/config');
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
                to: Config.testphoneNumber,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
