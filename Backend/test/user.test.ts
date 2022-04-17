process.env['PORT'] = 3020;
import { expect } from 'chai';
import data from './data/user';
const profile: $TSFixMe = require('./data/user').profile;
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
// Import decode from 'urldecode' unused
import queryString from 'query-string';
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import UserModel from '../backend/models/user';
import SsoModel from '../backend/models/sso';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';

import LoginIPLog from '../backend/models/loginIPLog';
import VerificationTokenModel from '../backend/models/verificationToken';

import { fetchIdpSAMLResponse } from './utils/test-utils';

let projectId: ObjectID, userId: ObjectID, token: $TSFixMe;
const deleteAccountConfirmation: $TSFixMe = {
    deleteMyAccount: 'DELETE MY ACCOUNT',
};

describe('User API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                data.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    if (err) {
                        throw err;
                    }
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        (err: $TSFixMe, verificationToken: $TSFixMe): void => {
                            if (err) {
                                throw err;
                            }
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end((): void => {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: data.user.email,
                                            password: data.user.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            if (err) {
                                                throw err;
                                            }
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            done();
                                        });
                                });
                        }
                    );
                }
            );
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
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /user/signup'

    it('should register with name, email, password, companyName, jobRole, referral, companySize, stripeToken, stripePlanId', (done: $TSFixMe): void => {
        createUser(
            request,
            data.newUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                done();
            }
        );
    });

    it('should not register when name, email, password, companyName, jobRole, referral, companySize, stripePlanId or stripeToken is null', (done: $TSFixMe): void => {
        createUser(
            request,
            data.nullUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            }
        );
    });

    it('should not register with same email', (done: $TSFixMe): void => {
        createUser(request, data.user, (err: $TSFixMe, res: $TSFixMe): void => {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not register with an invalid email', (done: $TSFixMe): void => {
        const invalidMailUser: $TSFixMe = Object.assign({}, data.user);
        invalidMailUser.email = 'invalidMail';
        createUser(
            request,
            invalidMailUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            }
        );
    });

    it('should not register with a personal email', (done: $TSFixMe): void => {
        const personalMailUser: $TSFixMe = Object.assign({}, data.user);
        personalMailUser.email = 'personalAccount@gmail.com';
        createUser(
            request,
            personalMailUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            }
        );
    });

    // Post '/user/login'

    it('should not login when email is null', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: null,
                password: data.user.password,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    // Post '/user/login'

    it('should not login when password is null', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: data.user.email,
                password: null,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not allow to login with invalid email', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: 'invalidEmail',
                password: data.user.password,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not allow to login with invalid password', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: data.user.email,
                password: {},
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should track IP and other parameters when login in', async (): void => {
        const res: $TSFixMe = await request.post('/user/login').send({
            email: data.user.email,
            password: data.user.password,
        });
        expect(res).to.have.status(200);
        expect(res.body.email).to.equal(data.user.email);
        const log: $TSFixMe = await LoginIPLog.findOne({ userId });
        expect(log).to.be.an('object');
        expect(log).to.have.property('ipLocation');
        expect(log.ipLocation).to.be.an('object');
        expect(log.ipLocation.ip).to.be.equal('::ffff:127.0.0.1');
    });

    it('should login with valid credentials', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                expect(res.body).include.keys('tokens');
                done();
            });
    });

    it('should login with valid credentials, and return sent redirect url', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
                redirect: 'http://oneuptime.com',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                expect(res.body).have.property('redirect');
                expect(res.body.redirect).to.eql('http://oneuptime.com');
                done();
            });
    });

    it('should not accept `/forgot-password` request when email is null', (done: $TSFixMe): void => {
        request
            .post('/user/forgot-password')
            .send({
                email: null,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not accept `/forgot-password` request when email is invalid', (done: $TSFixMe): void => {
        request
            .post('/user/forgot-password')
            .send({
                email: '(' + data.user.email + ')',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should accept `/forgot-password` request when email is valid', (done: $TSFixMe): void => {
        request
            .post('/user/forgot-password')
            .send({
                email: data.newUser.email,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    // Post '/user/reset-password'

    it('should not accept `/user/reset-password` request when token is null', (done: $TSFixMe): void => {
        request
            .post('/user/reset-password')
            .send({
                password: data.user.password,
                token: null,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    // Post '/user/reset-password'

    it('should not accept `/user/reset-password` request when password is null', (done: $TSFixMe): void => {
        request
            .post('/user/reset-password')
            .send({
                password: null,
                token: 'randomToken',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should accept `/user/reset-password` request when password and token is valid', (done: $TSFixMe): void => {
        request
            .post('/user/forgot-password')
            .send({
                email: data.newUser.email,
            })
            .end((): void => {
                UserModel.findOne(
                    { email: data.newUser.email },
                    (err: $TSFixMe, user: $TSFixMe): void => {
                        request
                            .post('/user/reset-password')
                            .send({
                                password: 'newPassword',
                                token: user.resetPasswordToken,
                            })
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                expect(res).to.have.status(200);
                                done();
                            });
                    }
                );
            });
    });

    it('should not accept `/isInvited` request when email is null', (done: $TSFixMe): void => {
        request
            .post('/user/isInvited')
            .send({
                email: null,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should return a boolean response for the `/isInvited` request', (done: $TSFixMe): void => {
        request
            .post('/user/isInvited')
            .send({
                email: data.user.email,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.a('boolean');
                done();
            });
    });

    it('should update the profile settings of an authenticated user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put('/user/profile')
            .set('Authorization', authorization)
            .send(profile)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('_id');
                expect(res.body).to.not.have.property('password');
                expect(res.body._id).to.be.equal(userId);
                done();
            });
    });

    it('should not change a password when the `currentPassword` field is not valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: null,
                newPassword: 'abcdefghi',
                confirmPassword: 'abcdefghi',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not change a password when the `newPassword` field is not valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: '0123456789',
                newPassword: null,
                confirmPassword: 'abcdefghi',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not change a password when the `confirmPassword` field is not valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: '0123456789',
                newPassword: 'abcdefghi',
                confirmPassword: null,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should change a password when all fields are valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put('/user/changePassword')
            .set('Authorization', authorization)
            .send({
                currentPassword: '1234567890',
                newPassword: 'abcdefghi',
                confirmPassword: 'abcdefghi',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(userId);
                done();
            });
    });

    it('should get the profile of an authenticated user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get('/user/profile')
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('name');
                expect(res.body).to.not.have.property('password');
                expect(res.body.name).to.be.equal(profile.name);
                done();
            });
    });

    it('should not update the unverified alert phone number through profile update API', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put('/user/profile')
            .set('Authorization', authorization)
            .send(profile)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res.body._id).to.be.equal(userId);
                expect(res.body.alertPhoneNumber).not.to.be.equal(
                    profile.alertPhoneNumber
                );
                expect(res.body.alertPhoneNumber).to.be.equal('');
                done();
            });
    });

    it('should not delete account that belongs to another user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const anotherUserId: string = '5ef84e17504ba0deaac459d9';
        request
            .delete(`/user/${anotherUserId}/delete`)
            .set('Authorization', authorization)
            .end((_err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not delete account without confirmation from the user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/user/${userId}/delete`)
            .set('Authorization', authorization)
            .end((_err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should generate backup codes when the user tries to generate a QR code.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/user/totp/token/${userId}`)
            .set('Authorization', authorization)
            .end(async (_err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                const user: $TSFixMe = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'backupCodes',
                });
                expect(user).to.not.eql(null);
                expect(user.backupCodes).to.be.an('array');
                expect(user.backupCodes.length).to.eql(8);
                done();
            });
    });

    it('should generate new backup codes.', async (): void => {
        const authorization: string = `Basic ${token}`;
        const user: $TSFixMe = await UserService.updateOneBy(
            { _id: userId },
            { twoFactorAuthEnabled: true }
        );
        expect(user).to.not.eql(null);
        expect(user.twoFactorAuthEnabled).to.eql(true);
        const res: $TSFixMe = await request
            .post(`/user/generate/backupCode`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body.length).to.eql(8);
        expect(res.body).to.not.eql(user.backupCodes);
        expect(res.body[0].counter).to.eql(8);
        expect(res.body[7].counter).to.eql(15);
    });

    it('should delete user account and cancel all subscriptions', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/user/${userId}/delete`)
            .set('Authorization', authorization)
            .send(deleteAccountConfirmation)
            .end((_err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.user.deleted).to.equal(true);
                done();
            });
    });

    it('should not delete account twice', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/user/${userId}/delete`)
            .set('Authorization', authorization)
            .send(deleteAccountConfirmation)
            .end((_err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('Should delete user account and remove user from the project', (done: $TSFixMe): void => {
        createUser(
            request,
            data.anotherUser,
            (_err: $TSFixMe, res: $TSFixMe): void => {
                const project: $TSFixMe = res.body.project;
                const { id: userId } = res.body;
                VerificationTokenModel.findOne(
                    { userId },
                    (_err: $TSFixMe, verificationToken: $TSFixMe): void => {
                        request
                            .get(
                                `/user/confirmation/${verificationToken.token}`
                            )
                            .redirects(0)
                            .end((): void => {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: data.anotherUser.email,
                                        password: data.anotherUser.password,
                                    })
                                    .end((_err: $TSFixMe, res: $TSFixMe) => {
                                        const accessToken: $TSFixMe =
                                            res.body.tokens.jwtAccessToken;
                                        const authorization: string = `Basic ${accessToken}`;
                                        request
                                            .post(`/team/${project._id}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                emails: data.newUser.email,
                                                role: 'Member',
                                            })
                                            .end(
                                                (
                                                    _err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) => {
                                                    expect(
                                                        res.body[0].team.length
                                                    ).to.be.equal(2);
                                                    request
                                                        .delete(
                                                            `/user/${userId}/delete`
                                                        )
                                                        .set(
                                                            'Authorization',
                                                            authorization
                                                        )
                                                        .send(
                                                            deleteAccountConfirmation
                                                        )
                                                        .end(
                                                            (
                                                                _err: $TSFixMe,
                                                                res: $TSFixMe
                                                            ) => {
                                                                expect(
                                                                    res
                                                                ).to.have.status(
                                                                    200
                                                                );
                                                                expect(
                                                                    res.body
                                                                        .user
                                                                        .deleted
                                                                ).to.equal(
                                                                    true
                                                                );
                                                                done();
                                                            }
                                                        );
                                                }
                                            );
                                    });
                            });
                    }
                );
            }
        );
    });
});

let ssoId: $TSFixMe;

describe('SSO authentication', function (): void {
    this.timeout(20000);

    before(async () => {
        await SsoModel.deleteMany({});
        const sso: $TSFixMe = await SsoModel.create({
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

    it('Should not accept requests without email as query.', (done: $TSFixMe): void => {
        request
            .get('/user/sso/login')
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('Should not accept requests with invalid email.', (done: $TSFixMe): void => {
        request
            .get('/user/sso/login?email=invalid@email')
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it("Should not accept requests with domains that aren't defined in the ssos collection.", (done: $TSFixMe): void => {
        request
            .get('/user/sso/login?email=user@inexistant-domain.hackerbay.io')
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(404);
                done();
            });
    });

    it('Should not accept requests with domains having SSO disabled', (done: $TSFixMe): void => {
        SsoModel.updateOne(
            { _id: ssoId },
            { $set: { 'saml-enabled': false } }
        ).then(() => {
            request
                .get('/user/sso/login?email=user@tests.hackerbay.io')
                .end((err: $TSFixMe, res: $TSFixMe): void => {
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

    it('Should create a new user and return the login details if the user login successfully', async (): void => {
        let userCount: $TSFixMe = await UserModel.find({
            email: 'user1@tests.hackerbay.io',
        }).countDocuments();
        expect(userCount).to.eql(0);

        const loginRequest: $TSFixMe = await request.get(
            '/user/sso/login?email=user@tests.hackerbay.io'
        );
        expect(loginRequest).to.have.status(200);
        expect(loginRequest.body).to.have.property('url');
        const { url: SAMLRequest } = loginRequest.body;

        const SAMLResponse: $TSFixMe = await fetchIdpSAMLResponse({
            SAMLRequest,
            username: 'user1',
            password: 'user1pass',
        });

        let response: $TSFixMe;
        try {
            response = await request
                .post('/api/user/sso/callback')
                .redirects(0)
                .send({ SAMLResponse });
            expect(response).to.have.status(302);
        } catch (error) {
            expect(error.response).to.have.status(302);
            response = error.response;
        }
        const {
            header: { location: loginLink },
        } = response;
        const parsedQuery: $TSFixMe = queryString.parse(
            loginLink.split('?')[1]
        );

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

    it('Should return the login details if the user exists in the database and login successfully.', async (): void => {
        UserService.create({ email: 'user2@tests.hackerbay.io', sso: ssoId });

        const loginRequest: $TSFixMe = await request.get(
            '/user/sso/login?email=user@tests.hackerbay.io'
        );
        expect(loginRequest).to.have.status(200);
        expect(loginRequest.body).to.have.property('url');
        const { url: SAMLRequest } = loginRequest.body;

        const SAMLResponse: $TSFixMe = await fetchIdpSAMLResponse({
            SAMLRequest,
            username: 'user2',
            password: 'user2pass',
        });

        let response: $TSFixMe;
        try {
            response = await request
                .post('/api/user/sso/callback')
                .redirects(0)
                .send({ SAMLResponse });
            expect(response).to.have.status(302);
        } catch (error) {
            expect(error.response).to.have.status(302);
            response = error.response;
        }
        const {
            header: { location: loginLink },
        } = response;
        const parsedQuery: $TSFixMe = queryString.parse(
            loginLink.split('?')[1]
        );

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
