/* eslint-disable no-undef */

process.env.PORT = 3020;
process.env.IS_SAAS_SERVICE = true;
const chai = require('chai');
const expect = require('chai').expect;
const userData = require('./data/user');
const gitCredential = require('./data/gitCredential');
const app = require('../server');
chai.use(require('chai-http'));
const request = chai.request.agent(app);
const GlobalConfig = require('./utils/globalConfig');
const { createUser } = require('./utils/userSignUp');
const VerificationTokenModel = require('../backend/models/verificationToken');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const ComponentService = require('../backend/services/componentService');
const GitCredentialService = require('../backend/services/gitCredentialService');
const ApplicationSecurities = require('../backend/services/applicationSecurityService');
const ApplicationSecurityLogService = require('../backend/services/applicationSecurityLogService');

describe('Application Security API', function() {
    const timeout = 30000;
    let projectId,
        componentId,
        userId,
        token,
        applicationSecurityId,
        credentialId;

    this.timeout(timeout);
    before(function(done) {
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                UserService.updateOneBy(
                    { _id: userId },
                    { role: 'master-admin' }
                ).then(function() {
                    VerificationTokenModel.findOne({ userId }, function(
                        err,
                        verificationToken
                    ) {
                        request
                            .get(
                                `/user/confirmation/${verificationToken.token}`
                            )
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
                                            .post(`/component/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({ name: 'newComponent' })
                                            .end(function(err, res) {
                                                componentId = res.body._id;
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
            email: userData.user.email,
        });
        await ComponentService.hardDeleteBy({ projectId });
        await GitCredentialService.hardDeleteBy({ projectId });
        await ApplicationSecurities.hardDelete({ componentId });
        await ApplicationSecurityLogService.hardDelete({ componentId });
    });

    it('should create an application security', function(done) {
        const authorization = `Basic ${token}`;

        GitCredentialService.create({
            gitUsername: gitCredential.gitUsername,
            gitPassword: gitCredential.gitPassword,
            projectId,
        }).then(function(credential) {
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
                .end(function(err, res) {
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

    it('should update an application security', function(done) {
        const authorization = `Basic ${token}`;
        const update = { name: 'newname' };

        request
            .put(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .send(update)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(update.name);
                done();
            });
    });

    it('should get a particular application security in a component', function(done) {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
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

    it('should get all the application security in a component', function(done) {
        const authorization = `Basic ${token}`;

        request
            .get(`/security/${projectId}/${componentId}/application`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should get all the application security with a particular credential', function(done) {
        const authorization = `Basic ${token}`;

        request
            .get(`/security/${projectId}/application/${credentialId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should scan an application security', function(done) {
        this.timeout(300000);
        const authorization = `Basic ${token}`;

        request
            .post(
                `/security/${projectId}/application/scan/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should not create an application security if name already exist in the component', function(done) {
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
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application security with this name already exist in this component'
                );
                done();
            });
    });

    it('should not create an application security if git repository url already exist in the component', function(done) {
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
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application security with this git repository url already exist in this component'
                );
                done();
            });
    });

    it('should delete a particular application security', function(done) {
        const authorization = `Basic ${token}`;

        request
            .delete(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.deleted).to.be.true;
                done();
            });
    });

    it('should not create an application security if name is missing', function(done) {
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
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Security Name is required'
                );
                done();
            });
    });

    it('should not create an application security if git repository url is missing', function(done) {
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
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Repository URL is required'
                );
                done();
            });
    });

    it('should not create an application security if git credential is missing', function(done) {
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
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential is required'
                );
                done();
            });
    });

    it('should not scan an application security if it does not exist', function(done) {
        const authorization = `Basic ${token}`;
        const applicationSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .post(
                `/security/${projectId}/application/scan/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Security not found or does not exist'
                );
                done();
            });
    });

    it('should not delete a non-existing application security', function(done) {
        const authorization = `Basic ${token}`;
        const applicationSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .delete(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Security not found or does not exist'
                );
                done();
            });
    });

    it('should not get a non-existing application security', function(done) {
        const authorization = `Basic ${token}`;
        const applicationSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .get(
                `/security/${projectId}/${componentId}/application/${applicationSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application security not found or does not exist'
                );
                done();
            });
    });

    it('should not create an application security if git credential does not exist', function(done) {
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
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential not found or does not exist'
                );
                done();
            });
    });
});
