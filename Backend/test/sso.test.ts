process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import VerificationTokenModel from '../backend/models/verificationToken';
import SsoService from '../backend/services/ssoService';
import ProjectService from '../backend/services/projectService';

const ssoObject: $TSFixMe = {
    'saml-enable': true,
    domain: 'hackerbay.com',
    samlSsoUrl: 'hackerbay.com/login',
    certificateFingerprint: 'azertyuiop',
    remoteLogoutUrl: 'hackerbay.com/logout',
    ipRanges: '127.0.0.1',
};

let token: $TSFixMe, userId: ObjectID;

describe('SSO API', function (): void {
    this.timeout(300000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.adminUser,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        (err: $TSFixMe, verificationToken: $TSFixMe): void => {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end((): void => {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.adminUser.email,
                                            password:
                                                userData.adminUser.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            UserService.updateBy(
                                                { _id: userId },
                                                { role: 'master-admin' }
                                            ).then((): void => {
                                                done();
                                            });
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ 'users.userId': userId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.adminUser.email,
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    describe('should reject requests from an unauthenticated users', (): void => {
        it('should reject GET requests', (done: $TSFixMe): void => {
            request.get('/sso').end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
        });

        it('should reject POST requests', (done: $TSFixMe): void => {
            request.post('/sso').end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
        });

        it('should reject PUT requests', (done: $TSFixMe): void => {
            request
                .put('/sso/5ea951228877984ea9f47660')
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(401);
                    done();
                });
        });

        it('should reject DELETE requests', (done: $TSFixMe): void => {
            request
                .delete('/sso/5ea951228877984ea9f47660')
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(401);
                    done();
                });
        });
    });

    describe('GET /sso/', (): void => {
        it('should return SSOs list with count', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .get('/sso')
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    done();
                });
        });

        it('should return SSOs list with count, skip and limit (when skip&limit specified)', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .get('/sso?limit=10&skip=0')
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    expect(res.body).to.have.property('limit');
                    expect(res.body).to.have.property('skip');
                    done();
                });
        });
    });

    describe('POST /sso', (): void => {
        it('should create a new SSO', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(ssoObject)
                .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('_id');
                    expect(res.body).to.have.property('domain');
                    expect(res.body).to.have.property('samlSsoUrl');
                    expect(res.body).to.have.property('remoteLogoutUrl');

                    const sso: $TSFixMe = await SsoService.findOneBy({
                        query: { _id: res.body._id },
                        select: ' _id domain samlUrl remoteLogoutUrl',
                    });
                    expect(sso).to.be.an('object');
                    expect(sso).to.have.property('_id');
                    expect(sso).to.have.property('domain');
                    expect(sso).to.have.property('samlSsoUrl');
                    expect(sso).to.have.property('remoteLogoutUrl');

                    await SsoService.hardDeleteBy({ _id: res.body._id });
                    done();
                });
        });

        it('should not create a new SSO if domaine is not defined', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            const payload: $TSFixMe = { ...ssoObject };

            delete payload.domain;

            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(payload)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(400);
                    done();
                });
        });

        it('should not create a new SSO if Saml SSO url is not defined', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            const payload: $TSFixMe = { ...ssoObject };

            delete payload.samlSsoUrl;

            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(payload)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(400);
                    done();
                });
        });

        it('should not create a new SSO if remote logout url is not defined', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            const payload: $TSFixMe = { ...ssoObject };

            delete payload.remoteLogoutUrl;

            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(payload)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    describe('DELETE /sso', (): void => {
        it('should delete sso', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            SsoService.create(ssoObject).then(sso => {
                const { _id: ssoId } = sso;
                request
                    .delete(`/sso/${ssoId}`)
                    .set('Authorization', authorization)
                    .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.have.property('_id');
                        expect(res.body).to.have.property('domain');
                        expect(res.body).to.have.property('samlSsoUrl');
                        expect(res.body).to.have.property('remoteLogoutUrl');
                        const deletedSso: $TSFixMe = await SsoService.findOneBy(
                            {
                                query: { _id: res.body._id, deleted: true },
                                select: 'deleted',
                            }
                        );

                        expect(deletedSso).to.be.an('object');
                        expect(deletedSso.deleted).to.equal(true);

                        SsoService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
        });
    });

    describe('UPDATE /sso', (): void => {
        it('should update SSO', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            SsoService.create(ssoObject).then(sso => {
                const { _id: ssoId } = sso;
                const updatedSsoObject: $TSFixMe = { ...ssoObject };
                updatedSsoObject.domain = 'updated.hackerbay.com';
                updatedSsoObject.samlSsoUrl = 'updated.hackerbay.com/login';
                updatedSsoObject.remoteLogoutUrl =
                    'updated.hackerbay.com/logout';
                request
                    .put(`/sso/${ssoId}`)
                    .set('Authorization', authorization)
                    .send(updatedSsoObject)
                    .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        expect(res.body[0]).to.be.an('object');
                        expect(res.body[0].domain).to.equal(
                            updatedSsoObject.domain
                        );

                        const sso: $TSFixMe = await SsoService.findOneBy({
                            query: { _id: ssoId },
                            select: 'domain samlSsoUrl remoteLogoutUrl ',
                        });
                        expect(sso.domain).to.equal(updatedSsoObject.domain);
                        expect(sso.samlSsoUrl).to.equal(
                            updatedSsoObject.samlSsoUrl
                        );
                        expect(sso.remoteLogoutUrl).to.equal(
                            updatedSsoObject.remoteLogoutUrl
                        );

                        await SsoService.hardDeleteBy({ _id: ssoId });
                        done();
                    });
            });
        });
    });
});
