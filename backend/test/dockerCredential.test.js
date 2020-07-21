/* eslint-disable no-undef */

process.env.PORT = 3020;
process.env.IS_SAAS_SERVICE = true;
const chai = require('chai');
const expect = require('chai').expect;
const userData = require('./data/user');
const dockerCredential = require('./data/dockerCredential');
const app = require('../server');
chai.use(require('chai-http'));
const request = chai.request.agent(app);
const GlobalConfig = require('./utils/globalConfig');
const { createUser } = require('./utils/userSignUp');
const VerificationTokenModel = require('../backend/models/verificationToken');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const DockerCredentialService = require('../backend/services/dockerCredentialService');

describe('Docker Credential API', function() {
    const timeout = 30000;
    let projectId, userId, token, credentialId;
    const dockerRegistryUrl = dockerCredential.dockerRegistryUrl;
    const dockerUsername = dockerCredential.dockerUsername;
    const dockerPassword = dockerCredential.dockerPassword;

    this.timeout(timeout);
    before(function(done) {
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

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
                                    done();
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
        await DockerCredentialService.hardDeleteBy({
            projectId,
        });
    });

    it('should add docker credential', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            })
            .end(function(err, res) {
                credentialId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.dockerRegistryUrl).to.be.equal(
                    dockerRegistryUrl
                );
                done();
            });
    });

    it('should update a docker credential', function(done) {
        const authorization = `Basic ${token}`;
        const dockerUsername = 'username';
        const dockerPassword = 'hello1234567890';

        request
            .put(`/credential/${projectId}/dockerCredential/${credentialId}`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.dockerUsername).to.be.equal(dockerUsername);
                done();
            });
    });

    it('should not update docker credential with invalid username or password', function(done) {
        const authorization = `Basic ${token}`;
        const dockerUsername = 'randomUsername';
        const dockerPassword = 'randomPassword';

        request
            .put(`/credential/${projectId}/dockerCredential/${credentialId}`)
            .set('Authorization', authorization)
            .send({ dockerRegistryUrl, dockerUsername, dockerPassword })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Invalid docker credential'
                );
                done();
            });
    });

    it('should not add docker credential if username or password is invalid', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername: 'randomusername',
                dockerPassword: 'invalidpassword',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Invalid docker credential'
                );
                done();
            });
    });

    it('should remove a docker credential', function(done) {
        const authorization = `Basic ${token}`;

        request
            .delete(`/credential/${projectId}/dockerCredential/${credentialId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(credentialId);
                expect(res.body.deleted).to.be.true;
                done();
            });
    });

    it('should get all the docker credentials in a project', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            })
            .end(function() {
                request
                    .get(`/credential/${projectId}/dockerCredential`)
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('array');
                        done();
                    });
            });
    });

    it('should not create docker credential with an existing docker registry url and docker username in a project', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Credential already exist in this project'
                );
                done();
            });
    });

    it('should not create docker credential if docker registry url is missing', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl: '',
                dockerUsername,
                dockerPassword,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Registry URL is required'
                );
                done();
            });
    });

    it('should not create docker credential if docker username is missing', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername: '',
                dockerPassword,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Username is required'
                );
                done();
            });
    });

    it('should not create docker credential if docker password is missing', function(done) {
        const authorization = `Basic ${token}`;

        request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername: 'username',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Password is required'
                );
                done();
            });
    });

    it('should not remove a non-existing docker credential', function(done) {
        const authorization = `Basic ${token}`;
        const newCredentialId = '5e8db97b2cc46e3a229ebc62'; // non-existing credential id

        request
            .delete(
                `/credential/${projectId}/dockerCredential/${newCredentialId}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Credential not found or does not exist'
                );
                done();
            });
    });
});
