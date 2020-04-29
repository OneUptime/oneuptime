/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const plans = require('../backend/config/plans').getPlans();
const log = require('./data/log');
const UserService = require('../backend/services/userService');
const AirtableService = require('../backend/services/airtableService');
const GlobalConfig = require('./utils/globalConfig');
const VerificationTokenModel = require('../backend/models/verificationToken');

let token, userId, airtableId;

describe('SSO API', function () {
    this.timeout(300000);

    before(function (done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(request, userData.adminUser, function (err, res) {
                userId = res.body.id;
                airtableId = res.body.airtableId;

                VerificationTokenModel.findOne({ userId }, function (
                    err,
                    verificationToken
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function () {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.adminUser.email,
                                    password: userData.adminUser.password,
                                })
                                .end(function (err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    UserService.updateBy(
                                        { _id: userId },
                                        { role: 'master-admin' }
                                    ).then(function () {
                                        done();
                                    });
                                });
                        });
                });
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await AirtableService.deleteUser(airtableId);
    });

    describe('should reject request of an unauthenticated user', function () {
        it('should reject GET requests', function (done) {
            request.get('/sso')
                .end(function (err, res) {
                    expect(res).to.have.status(401);
                    done();
                })
        })
        it('should reject POST requests', function (done) {
            request.post('/sso')
                .end(function (err, res) {
                    expect(res).to.have.status(401);
                    done();
                })
        })
        it('should reject PUT requests', function (done) {
            request.put('/sso/ssoId')
                .end(function (err, res) {
                    expect(res).to.have.status(401);
                    done();
                })
        })
        it('should reject DELETE requests', function (done) {
            request.delete('/sso/ssoId')
                .end(function (err, res) {
                    expect(res).to.have.status(401);
                    done();
                })
        })
    })

    describe('should return the list of the create SSO', function () {
        it('should return SSOs list with count', function (done) {
            const authorization = `Basic ${token}`;
            request.get('/sso')
                .set('Authorization', authorization)
                .end(function (err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    done();
                })
        })
    })
});
