/* eslint-disable no-undef */

process.env.PORT = 3020;
process.env.IS_SAAS_SERVICE = true;
const chai = require('chai');
const expect = require('chai').expect;
const userData = require('./data/user');
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

describe('Application Security API', function() {
    const timeout = 30000;
    let projectId, componentId, userId, token, applicationSecurityId;

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
    });

    it('should create an application security', function(done) {
        const authorization = `Basic ${token}`;

        GitCredentialService.create({
            gitUsername: 'username',
            gitPassword: 'password',
            projectId,
        }).then(function(credential) {
            const data = {
                name: 'Test',
                gitRepositoryUrl: 'https://github.com',
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
});
