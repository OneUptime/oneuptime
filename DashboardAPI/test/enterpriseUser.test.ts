process.env['PORT'] = 3020;
import data from './data/user';
import chai, { expect } from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createEnterpriseUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';

let projectId: ObjectID,
    newProjectId: ObjectID,
    userRole: $TSFixMe,
    token: $TSFixMe;

describe('Enterprise User API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createEnterpriseUser(
                request,
                data.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;
                    userRole = res.body.role;

                    request
                        .post('/user/login')
                        .send({
                            email: data.user.email,
                            password: data.user.password,
                        })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            token = res.body.tokens.jwtAccessToken;
                            done();
                        });
                }
            );
        });
    });

    after(async () => {
        GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    data.user.email.toLowerCase(),
                    data.newUser.email.toLowerCase(),
                ],
            },
        });
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
    });

    it('should sign up initial user as `master-admin`', (): void => {
        expect(userRole).to.equal('master-admin');
    });

    it('should confirm that `master-admin` exists', (done: $TSFixMe): void => {
        request
            .get('/user/masterAdminExists')
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).have.property('result');
                expect(res.body.result).to.eql(true);
                done();
            });
    });

    // 'post /user/signup'

    it('should register `user` without stripeToken, stripePlanId', (done: $TSFixMe): void => {
        createEnterpriseUser(
            request,
            data.newUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                const project: $TSFixMe = res.body.project;
                newProjectId = project._id;
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(
                    data.newUser.email.toLocaleLowerCase()
                );
                expect(res.body.role).to.equal('user');
                done();
            }
        );
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
                expect(res.body.email).to.equal(
                    data.newUser.email.toLocaleLowerCase()
                );
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
                expect(res.body.email).to.equal(
                    data.newUser.email.toLocaleLowerCase()
                );
                expect(res.body).have.property('redirect');
                expect(res.body.redirect).to.eql('http://oneuptime.com');
                done();
            });
    });

    it('should get list of users without their hashed passwords', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get('/user/users')
            .set('Authorization', authorization)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data.length).to.eql(2);
                const { data }: $TSFixMe = res.body;
                for (const element of data) {
                    expect(element).to.be.an('object');
                    expect(element).to.not.have.property('password');
                }
                done();
            });
    });

    it('should turn off 2fa for a user', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .then((res: $TSFixMe): void => {
                const jwtToken: $TSFixMe = res.body.tokens.jwtAccessToken;
                request
                    .put('/user/profile')
                    .set('Authorization', `Basic ${jwtToken}`)
                    .send({
                        twoFactorAuthEnabled: true,
                        email: data.newUser.email,
                    })
                    .then((res: $TSFixMe): void => {
                        request
                            .put(`/user/${res.body._id}/2fa`)
                            .set('Authorization', `Basic ${token}`)
                            .send({
                                email: data.newUser.email.toLocaleLowerCase(),
                                twoFactorAuthEnabled:
                                    !res.body.twoFactorAuthEnabled,
                            })
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                expect(res.body.twoFactorAuthEnabled).to.eql(
                                    false
                                );
                                done();
                            });
                    });
            });
    });

    it('should not turn off 2fa for a user if loged in user is not admin', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .then((res: $TSFixMe): void => {
                const jwtToken: $TSFixMe = res.body.tokens.jwtAccessToken;
                request
                    .put('/user/profile')
                    .set('Authorization', `Basic ${jwtToken}`)
                    .send({
                        twoFactorAuthEnabled: true,
                        email: data.newUser.email,
                    })
                    .then((res: $TSFixMe): void => {
                        request
                            .put(`/user/${res.body._id}/2fa`)
                            .set('Authorization', `Basic ${jwtToken}`)
                            .send({
                                email: data.newUser.email,
                                twoFactorAuthEnabled:
                                    !res.body.twoFactorAuthEnabled,
                            })
                            .end((err: $TSFixMe, result: $TSFixMe): void => {
                                expect(result).to.have.status(400);
                                done();
                            });
                    });
            });
    });
});
