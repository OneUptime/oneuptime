/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
const app = require('../server');
const userData = require('./data/user');
const { newProject } = require('./data/project');
const gitCredential = require('./data/gitCredential');
const { createUser } = require('./utils/userSignUp');
const VerificationTokenModel = require('../backend/models/verificationToken');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const request = chai.request.agent(app);
const ProbeService = require('../backend/services/probeService');
const ComponentService = require('../backend/services/componentService');
const GitCredentialService = require('../backend/services/gitCredentialService');
const ApplicationSecurityService = require('../backend/services/applicationSecurityService');
let probeId;
const GlobalConfig = require('./utils/globalConfig');
let token, userId, projectId, componentId, applicationSecurityId;
const probeKey = 'test-key';
const generateRandomString = require('./utils/string').generateRandomString;

describe('Probe API', function() {
    this.timeout(20000);

    before(async function() {
        this.timeout(40000);
        await GlobalConfig.initTestConfig();

        const user = await UserService.create({
            ...userData.user,
            role: 'master-admin',
        });

        const project = await ProjectService.create({
            name: 'New Test Project',
            userId: user._id,
            stripePlanId: newProject.stripePlanId,
            stripeSubscriptionId: newProject.stripeSubscriptionId,
        });
        projectId = project._id;

        const component = await ComponentService.create({
            name: 'New Test Component',
            projectId,
        });
        componentId = component._id;

        const response = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });

        token = response.body.tokens.jwtAccessToken;
        return Promise.resolve();
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProbeService.hardDeleteBy({ _id: probeId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await ComponentService.hardDeleteBy({ _id: componentId });
        await GitCredentialService.hardDeleteBy({ projectId });
        await ApplicationSecurityService.hardDelete({ componentId });
    });

    it('should add a probe by admin', function(done) {
        const authorization = `Basic ${token}`;
        const probeName = generateRandomString();
        request
            .post('/probe/')
            .set('Authorization', authorization)
            .send({
                probeName: probeName,
                probeKey: probeKey,
            })
            .end(function(err, res) {
                probeId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.probeName).to.be.equal(probeName);
                done();
            });
    });

    it('should not add a probe if not admin', function(done) {
        const probeName = generateRandomString();
        createUser(request, userData.newUser, function(err, res) {
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
                                email: userData.newUser.email,
                                password: userData.newUser.password,
                            })
                            .end(function(err, res) {
                                const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                request
                                    .post('/probe/')
                                    .set('Authorization', authorization)
                                    .send({
                                        probeName: probeName,
                                        probeKey: '',
                                    })
                                    .end(function(err, res) {
                                        expect(res).to.have.status(400);
                                        done();
                                    });
                            });
                    });
            });
        });
    });

    it('should reject a probe if same name already exists', function(done) {
        const authorization = `Basic ${token}`;
        const probeName = generateRandomString();
        request
            .post('/probe/')
            .set('Authorization', authorization)
            .send({
                probeName: probeName,
                probeKey: probeKey,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                request
                    .post('/probe/')
                    .set('Authorization', authorization)
                    .send({
                        probeName: probeName,
                        probeKey: probeKey,
                    })
                    .end(function(err, res) {
                        expect(res).to.have.status(400);
                        done();
                    });
            });
    });

    it('should get probes', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get('/probe/')
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete a probe by admin', function(done) {
        const authorization = `Basic ${token}`;
        const probeName = generateRandomString();
        request
            .post('/probe/')
            .set('Authorization', authorization)
            .send({
                probeName: probeName,
                probeKey: probeKey,
            })
            .end(function(err, res) {
                probeId = res.body._id;
                expect(res).to.have.status(200);
                request
                    .delete(`/probe/${probeId}`)
                    .set('Authorization', authorization)
                    .send()
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        done();
                    });
            });
    });

    it('should get application securities yet to be scanned or scanned 24hrs ago', function(done) {
        const authorization = `Basic ${token}`;
        const probeName = 'US';
        const probeKey = '33b674ca-9fdd-11e9-a2a3-2a2ae2dbccez';
        const clusterKey = 'f414c23b4cdf4e84a6a66ecfd528eff2';

        GitCredentialService.create({
            gitUsername: gitCredential.gitUsername,
            gitPassword: gitCredential.gitPassword,
            projectId,
        }).then(function(credential) {
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

                    request
                        .get('/probe/applicationSecurities')
                        .set({
                            probeName,
                            probeKey,
                            clusterKey,
                        })
                        .end(function(err, res) {
                            expect(res).to.have.status(200);
                            expect(res.body).to.be.an('array');
                            done();
                        });
                });
        });
    });
});
