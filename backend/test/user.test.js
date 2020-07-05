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

const fetchIdpSAMLResponse = async function({
    SAMLRequest,
    username,
    password,
}) {
    let firstIdpResponse;
    try {
        await chai
            .request(SAMLRequest)
            .get('')
            .redirects(0);
    } catch (error) {
        expect(error.response).to.have.status(302);
        firstIdpResponse = error.response;
    }

    const {
        headers: { location, 'set-cookie': cookies },
    } = firstIdpResponse;
    const [postSubmissionUrl, AuthState] = location.split('AuthState=');

    const samlResponsePage = await chai
        .request(postSubmissionUrl)
        .post('')
        .set('Referer', SAMLRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Cookie', cookies[0])
        .send({
            username,
            password,
            AuthState: decode(AuthState),
        });

    const {
        res: { text: html },
    } = samlResponsePage;
    const { parse } = require('node-html-parser');
    const root = parse(html);
    // const form = root.querySelector('form');
    // const callbackUrl = form.rawAttrs.split('\"')[3]
    const input = root.querySelectorAll('input')[1];
    const value = input.rawAttrs.split(' ')[2];
    const SAMLResponse = value.split('"')[1];
    return SAMLResponse;
};

let projectId, userId, airtableId, token;
const deleteAccountConfirmation = { deleteMyAccount: 'DELETE MY ACCOUNT' };

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

    it('should not delete account that belongs to another user', function(done) {
        const authorization = `Basic ${token}`;
        const anotherUserId = '5ef84e17504ba0deaac459d9';
        request
            .delete(`/user/${anotherUserId}/delete`)
            .set('Authorization', authorization)
            .end(function(_err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not delete account without confirmation from the user', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/user/${userId}/delete`)
            .set('Authorization', authorization)
            .end(function(_err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should delete user account and cancel all subscriptions', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/user/${userId}/delete`)
            .set('Authorization', authorization)
            .send(deleteAccountConfirmation)
            .end(function(_err, res) {
                expect(res).to.have.status(200);
                expect(res.body.user.deleted).to.equal(true);
                done();
            });
    });

    it('should not delete account twice', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/user/${userId}/delete`)
            .set('Authorization', authorization)
            .send(deleteAccountConfirmation)
            .end(function(_err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('Should delete user account and remove user from the project', function(done) {
        createUser(request, data.anotherUser, function(_err, res) {
            const project = res.body.project;
            const { id: userId } = res.body;
            VerificationTokenModel.findOne({ userId }, function(
                _err,
                verificationToken
            ) {
                request
                    .get(`/user/confirmation/${verificationToken.token}`)
                    .redirects(0)
                    .end(function() {
                        request
                            .post('/user/login')
                            .send({
                                email: data.anotherUser.email,
                                password: data.anotherUser.password,
                            })
                            .end(function(_err, res) {
                                const accessToken =
                                    res.body.tokens.jwtAccessToken;
                                const authorization = `Basic ${accessToken}`;
                                request
                                    .post(`/team/${project._id}`)
                                    .set('Authorization', authorization)
                                    .send({
                                        emails: data.newUser.email,
                                        role: 'Member',
                                    })
                                    .end(function(_err, res) {
                                        expect(
                                            res.body[0].team.length
                                        ).to.be.equal(2);
                                        request
                                            .delete(`/user/${userId}/delete`)
                                            .set('Authorization', authorization)
                                            .send(deleteAccountConfirmation)
                                            .end(function(_err, res) {
                                                expect(res).to.have.status(200);
                                                expect(
                                                    res.body.user.deleted
                                                ).to.equal(true);
                                                done();
                                            });
                                    });
                            });
                    });
            });
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
                'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
            remoteLogoutUrl: 'http://localhost:9876/logout',
        });
        ssoId = sso._id;
    });

    after(async () => {
        await SsoModel.deleteOne({ _id: ssoId });
        await UserModel.deleteMany({
            $or: [
                { email: 'user1@tests.hackerbay.io' },
                { email: 'user2@tests.hackerbay.io' },
            ],
        });
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
            .get('/user/sso/login?email=user@inexistant-domain.hackerbay.io')
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
                .get('/user/sso/login?email=user@tests.hackerbay.io')
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

    it('Should create a new user and return the login details if the user login successfully', async function() {
        let userCount = await UserModel.find({
            email: 'user1@tests.hackerbay.io',
        }).countDocuments();
        expect(userCount).to.eql(0);

        const loginRequest = await request.get(
            '/user/sso/login?email=user@tests.hackerbay.io'
        );
        expect(loginRequest).to.have.status(200);
        expect(loginRequest.body).to.have.property('url');
        const { url: SAMLRequest } = loginRequest.body;

        const SAMLResponse = await fetchIdpSAMLResponse({
            SAMLRequest,
            username: 'user1',
            password: 'user1pass',
        });

        let response;
        try {
            await request
                .post('/api/user/sso/callback')
                .redirects(0)
                .send({ SAMLResponse });
        } catch (error) {
            expect(error.response).to.have.status(302);
            response = error.response;
        }
        const {
            header: { location: loginLink },
        } = response;
        const parsedQuery = queryString.parse(loginLink.split('?')[1]);

        expect(parsedQuery).to.have.property('id');
        expect(parsedQuery).to.have.property('name');
        expect(parsedQuery).to.have.property('email');
        expect(parsedQuery).to.have.property('jwtAccessToken');
        expect(parsedQuery).to.have.property('jwtRefreshToken');
        expect(parsedQuery).to.have.property('role');
        expect(parsedQuery).to.have.property('redirect');
        expect(parsedQuery).to.have.property('cardRegistered');
        expect(parsedQuery.email).to.eql('user1@tests.hackerbay.io');

        userCount = await UserModel.find({
            email: 'user1@tests.hackerbay.io',
        }).countDocuments();
        expect(userCount).to.eql(1);
    });

    it('Should return the login details if the user exists in the database and login successfully.', async function() {
        UserService.create({ email: 'user2@tests.hackerbay.io', sso: ssoId });

        const loginRequest = await request.get(
            '/user/sso/login?email=user@tests.hackerbay.io'
        );
        expect(loginRequest).to.have.status(200);
        expect(loginRequest.body).to.have.property('url');
        const { url: SAMLRequest } = loginRequest.body;

        const SAMLResponse = await fetchIdpSAMLResponse({
            SAMLRequest,
            username: 'user2',
            password: 'user2pass',
        });

        let response;
        try {
            await request
                .post('/api/user/sso/callback')
                .redirects(0)
                .send({ SAMLResponse });
        } catch (error) {
            expect(error.response).to.have.status(302);
            response = error.response;
        }
        const {
            header: { location: loginLink },
        } = response;
        const parsedQuery = queryString.parse(loginLink.split('?')[1]);

        expect(parsedQuery).to.have.property('id');
        expect(parsedQuery).to.have.property('name');
        expect(parsedQuery).to.have.property('email');
        expect(parsedQuery).to.have.property('jwtAccessToken');
        expect(parsedQuery).to.have.property('jwtRefreshToken');
        expect(parsedQuery).to.have.property('role');
        expect(parsedQuery).to.have.property('redirect');
        expect(parsedQuery).to.have.property('cardRegistered');
        expect(parsedQuery.email).to.eql('user2@tests.hackerbay.io');
    });
});
