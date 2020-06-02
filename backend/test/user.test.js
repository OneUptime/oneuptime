/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const data = require('./data/user');
const profile = require('./data/user').profile;
const chai = require('chai');
chai.use(require('chai-http'));
const decode = require('urldecode');
const queryString = require('query-string');
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const UserModel = require('../backend/models/user');
const SsoModel = require('../backend/models/sso');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');

const LoginIPLog = require('../backend/models/loginIPLog');
const VerificationTokenModel = require('../backend/models/verificationToken');

let projectId, userId, airtableId, token;

describe('User API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, data.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
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
                                    email: data.user.email,
                                    password: data.user.password,
                                })
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    done();
                                });
                        });
                });
            });
        });
    });

    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    data.user.email,
                    data.newUser.email,
                    data.anotherUser.email,
                ],
            },
        });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await LoginIPLog.deleteMany({ userId });
        await AirtableService.deleteUser(airtableId);
    });

    // 'post /user/signup'
    it('should register with name, email, password, companyName, jobRole, referral, companySize, stripeToken, stripePlanId', function(done) {
        createUser(request, data.newUser, function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body.email).to.equal(data.newUser.email);
            done();
        });
    });

    it('should not register when name, email, password, companyName, jobRole, referral, companySize, stripePlanId or stripeToken is null', function(done) {
        createUser(request, data.nullUser, function(err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not register with same email', function(done) {
        createUser(request, data.user, function(err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not register with an invalid email', function(done) {
        const invalidMailUser = Object.assign({}, data.user);
        invalidMailUser.email = 'invalidMail';
        createUser(request, invalidMailUser, function(err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not register with a personal email', function(done) {
        const personalMailUser = Object.assign({}, data.user);
        personalMailUser.email = 'personalAccount@gmail.com';
        createUser(request, personalMailUser, function(err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    // post '/user/login'
    it('should not login when email is null', function(done) {
        request
            .post('/user/login')
            .send({
                email: null,
                password: data.user.password,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // post '/user/login'
    it('should not login when password is null', function(done) {
        request
            .post('/user/login')
            .send({
                email: data.user.email,
                password: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not allow to login with invalid email', function(done) {
        request
            .post('/user/login')
            .send({
                email: 'invalidEmail',
                password: data.user.password,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not allow to login with invalid password', function(done) {
        request
            .post('/user/login')
            .send({
                email: data.user.email,
                password: {},
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should track IP and other parameters when login in', async function() {
        const res = await request.post('/user/login').send({
            email: data.user.email,
            password: data.user.password,
        });
        expect(res).to.have.status(200);
        expect(res.body.email).to.equal(data.user.email);
        const log = await LoginIPLog.findOne({ userId });
        expect(log).to.be.an('object');
        expect(log).to.have.property('ipLocation');
        expect(log.ipLocation).to.be.an('object');
        expect(log.ipLocation.ip).to.be.equal('::ffff:127.0.0.1');
    });

    it('should login with valid credentials', function(done) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                expect(res.body).include.keys('tokens');
                done();
            });
    });

    it('should login with valid credentials, and return sent redirect url', function(done) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
                redirect: 'http://fyipe.com',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                expect(res.body).have.property('redirect');
                expect(res.body.redirect).to.eql('http://fyipe.com');
                done();
            });
    });

    it('should not accept `/forgot-password` request when email is null', function(done) {
        request
            .post('/user/forgot-password')
            .send({
                email: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not accept `/forgot-password` request when email is invalid', function(done) {
        request
            .post('/user/forgot-password')
            .send({
                email: '(' + data.user.email + ')',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should accept `/forgot-password` request when email is valid', function(done) {
        request
            .post('/user/forgot-password')
            .send({
                email: data.newUser.email,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    // post '/user/reset-password'
    it('should not accept `/user/reset-password` request when token is null', function(done) {
        request
            .post('/user/reset-password')
            .send({
                password: data.user.password,
                token: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // post '/user/reset-password'
    it('should not accept `/user/reset-password` request when password is null', function(done) {
        request
            .post('/user/reset-password')
            .send({
                password: null,
                token: 'randomToken',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should accept `/user/reset-password` request when password and token is valid', function(done) {
        request
            .post('/user/forgot-password')
            .send({
                email: data.newUser.email,
            })
            .end(function() {
                UserModel.findOne({ email: data.newUser.email }, function(
                    err,
                    user
                ) {
                    request
                        .post('/user/reset-password')
                        .send({
                            password: 'newPassword',
                            token: user.resetPasswordToken,
                        })
                        .end(function(err, res) {
                            expect(res).to.have.status(200);
                            done();
                        });
                });
            });
    });

    it('should not accept `/isInvited` request when email is null', function(done) {
        request
            .post('/user/isInvited')
            .send({
                email: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should return a boolean response for the `/isInvited` request', function(done) {
        request
            .post('/user/isInvited')
            .send({
                email: data.user.email,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.a('boolean');
                done();
            });
    });

    it('should update the profile settings of an authenticated user', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/user/profile')
            .set('Authorization', authorization)
            .send(profile)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(userId);
                done();
            });
    });

    it('should not change a password when the `currentPassword` field is not valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: null,
                newPassword: 'abcdefghi',
                confirmPassword: 'abcdefghi',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not change a password when the `newPassword` field is not valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: '0123456789',
                newPassword: null,
                confirmPassword: 'abcdefghi',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not change a password when the `confirmPassword` field is not valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: '0123456789',
                newPassword: 'abcdefghi',
                confirmPassword: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should change a password when all fields are valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: '1234567890',
                newPassword: 'abcdefghi',
                confirmPassword: 'abcdefghi',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(userId);
                done();
            });
    });

    it('should get the profile of an authenticated user', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get('/user/profile')
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(profile.name);
                done();
            });
    });

    it('should not update the unverified alert phone number through profile update API', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/user/profile')
            .set('Authorization', authorization)
            .send(profile)
            .end(function(err, res) {
                expect(res.body._id).to.be.equal(userId);
                expect(res.body.alertPhoneNumber).not.to.be.equal(
                    profile.alertPhoneNumber
                );
                expect(res.body.alertPhoneNumber).to.be.equal('');
                done();
            });
    });
});

let ssoId;
describe('SSO authentication', function() {
    this.timeout(20000);
    before(async () => {
        await SsoModel.deleteMany({});
        const sso = await SsoModel.create({
            'saml-enabled': true,
            domain: 'tests.hackerbay.io',
            samlSsoUrl:
                'https://dev-m23jrw-w.auth0.com/samlp/pCjtweXBYfdpL3fYDeCV3DvpAbe0xZQM',
            remoteLogoutUrl: 'http://localhost/logout',
        });
        ssoId = sso._id;
    });

    after(async () => {
        await SsoModel.deleteOne({ _id: ssoId });
    });

    // GET /user/sso/login
    it('Should not accept requests without email as query.', function(done) {
        request.get('/user/sso/login').end(function(err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('Should not accept requests with invalid email.', function(done) {
        request
            .get('/user/sso/login?email=invalid@email')
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it("Should not accept requests with domains that aren't defined in the ssos collection.", function(done) {
        request
            .get('/user/sso/login?email=user@undefinedsso.domain')
            .end(function(err, res) {
                expect(res).to.have.status(404);
                done();
            });
    });

    it('Should not accept requests with domains having SSO disabled', function(done) {
        SsoModel.updateOne(
            { _id: ssoId },
            { $set: { 'saml-enabled': false } }
        ).then(() => {
            request
                .get('/user/sso/login?email=user@hackerbay.io')
                .end(function(err, res) {
                    expect(res).to.have.status(401);
                    SsoModel.updateOne(
                        { _id: ssoId },
                        { $set: { 'saml-enabled': true } }
                    ).then(() => {
                        done();
                    });
                });
        });
    });

    it('Should return samlSsoUrl for requests with domains having SSO enabled', function(done) {
        request
            .get('/user/sso/login?email=user@hackerbay.io')
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('url');
                done();
            });
    });

    it('Should return user login details if the user login successfully', function(done) {
        SsoModel.findById(ssoId).then(sso => {
            const { samlSsoUrl } = sso;
            request.get(samlSsoUrl).end((err, res) => {
                //Connect to the identity provide or forge SAML response and send it to the endpoint.
                done();
            });
        });
    });
});
