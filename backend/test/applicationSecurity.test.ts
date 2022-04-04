process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai from 'chai';
import { expect } from 'chai';
import userData from './data/user';
import gitCredential from './data/gitCredential';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ComponentService from '../backend/services/componentService';
import GitCredentialService from '../backend/services/gitCredentialService';
import ApplicationSecurities from '../backend/services/applicationSecurityService';
import ApplicationSecurityLogService from '../backend/services/applicationSecurityLogService';
import AirtableService from '../backend/services/airtableService';

describe('Application Security API', function () {
    const timeout = 300000;
    let projectId: $TSFixMe,
        componentId: $TSFixMe,
        userId: string,
        token: $TSFixMe,
        applicationSecurityId: $TSFixMe,
        credentialId: $TSFixMe;

    this.timeout(timeout);

    before(function (done: $TSFixMe) {
        GlobalConfig.initTestConfig().then(function () {
            createUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: $TSFixMe) {
                    const project = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;

                    UserService.updateOneBy(
                        { _id: userId },
                        { role: 'master-admin' }
                    ).then(function () {
                        VerificationTokenModel.findOne(
                            { userId },
                            function (
                                err: $TSFixMe,
                                verificationToken: $TSFixMe
                            ) {
                                request
                                    .get(
                                        `/user/confirmation/${verificationToken.token}`
                                    )
                                    .redirects(0)
                                    .end(function () {
                                        request
                                            .post('/user/login')
                                            .send({
                                                email: userData.user.email,
                                                password:
                                                    userData.user.password,
                                            })
                                            .end(function (
                                                err: $TSFixMe,
                                                res: $TSFixMe
                                            ) {
                                                token =
                                                    res.body.tokens
                                                        .jwtAccessToken;
                                                const authorization = `Basic ${token}`;

                                                request
                                                    .post(
                                                        `/component/${projectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        name: 'newComponent',
                                                    })
                                                    .end(function (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ) {
                                                        componentId =
                                                            res.body._id;
                                                        done();
                                                    });
                                            });
                                    });
                            }
                        );
                    });
                }
            );
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email,
        });
        await ComponentService.hardDeleteBy({ projectId });
        await GitCredentialService.hardDeleteBy({ projectId });
        await ApplicationSecurities.hardDelete({ componentId });
        await ApplicationSecurityLogService.hardDelete({ componentId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should create an application security', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        GitCredentialService.create({
            gitUsername: gitCredential.gitUsername,
            gitPassword: gitCredential.gitPassword,
            projectId,
        }).then(function (credential) {
            credentialId = credential._id;
            const data = {
                name: 'Test',
                gitRepositoryUrl: gitCredential.gitRepositoryUrl,

                gitCredential: credential._id,
            };

            request
                .post(`/security/${projectId}/${componentId}/application`)
                .set('Authorization', authorization)
                .send(data)
                .end(function (err: $TSFixMe, res: $TSFixMe) {
                    applicationSecurityId = res.body._id;
                    expect(res).to.have.status(200);
                    expect(res.body.componentId).to.be.equal(componentId);
                    expect(res.body.name).to.be.equal(data.name);
                    expect(res.body.gitRepositoryUrl).to.be.equal(
                        data.gitRepositoryUrl
                    );
                    expect(String(res.body.gitCredential)).to.be.equal(
                        String(data.gitCredential)
                    );
                    done();
                });
        });
    });

    it('should update an application security', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const update = { name: 'newname' };

        request
            .put(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .send(update)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(update.name);
                done();
            });
    });

    it('should get a particular application security in a component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(String(res.body._id)).to.be.equal(
                    String(applicationSecurityId)
                );
                expect(String(res.body.componentId._id)).to.be.equal(
                    String(componentId)
                );
                done();
            });
    });

    it('should get all the application security in a component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should get all the application security with a particular credential', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(`/security/${projectId}/application/${credentialId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should scan an application security', function (done: $TSFixMe) {
        this.timeout(300000);
        const authorization = `Basic ${token}`;

        request
            .post(
                `/security/${projectId}/application/scan/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should not create an application security if name already exist in the component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        const data = {
            name: 'newname',
            gitRepositoryUrl: 'https://github.com',
            gitCredential: credentialId,
        };

        request
            .post(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .send(data)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application security with this name already exist in this component'
                );
                done();
            });
    });

    it('should not create an application security if git repository url already exist in the component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        const data = {
            name: 'anothername',
            gitRepositoryUrl: gitCredential.gitRepositoryUrl,
            gitCredential: credentialId,
        };

        request
            .post(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .send(data)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application security with this git repository url already exist in this component'
                );
                done();
            });
    });

    it('should delete a particular application security', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .delete(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.deleted).to.be.true;
                done();
            });
    });

    it('should not create an application security if name is missing', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        const data = {
            name: '',
            gitRepositoryUrl: gitCredential.gitRepositoryUrl,
            gitCredential: credentialId,
        };

        request
            .post(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .send(data)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Security Name is required'
                );
                done();
            });
    });

    it('should not create an application security if git repository url is missing', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        const data = {
            name: 'AnotherTest',
            gitRepositoryUrl: '',
            gitCredential: credentialId,
        };

        request
            .post(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .send(data)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Repository URL is required'
                );
                done();
            });
    });

    it('should not create an application security if git credential is missing', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        const data = {
            name: 'AnotherTest',
            gitRepositoryUrl: gitCredential.gitRepositoryUrl,
            gitCredential: '',
        };

        request
            .post(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .send(data)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential is required'
                );
                done();
            });
    });

    it('should not scan an application security if it does not exist', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const applicationSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .post(
                `/security/${projectId}/application/scan/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Security not found or does not exist'
                );
                done();
            });
    });

    it('should not delete a non-existing application security', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const applicationSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .delete(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Security not found or does not exist'
                );
                done();
            });
    });

    it('should not get a non-existing application security', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const applicationSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .get(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application security not found or does not exist'
                );
                done();
            });
    });

    it('should not create an application security if git credential does not exist', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        const data = {
            name: 'AnotherTest',
            gitRepositoryUrl: gitCredential.gitRepositoryUrl,
            gitCredential: '5e8db9752cc46e3a229ebc51',
        };

        request
            .post(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .send(data)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential not found or does not exist'
                );
                done();
            });
    });
});
