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
const GitCredentialService = require('../backend/services/gitCredentialService');

describe('Docker Credential API', function() {
    const timeout = 30000;
    let projectId, userId, token, credentialId;

    this.timeout(timeout);
    before(function(done) {
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                let project = res.body.project;
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
        await GitCredentialService.hardDeleteBy({
            gitUsername: 'username',
        });
    });

    it('should add git credential', function(done) {
        const authorization = `Basic ${token}`;
        const gitUsername = 'username';
        const gitPassword = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end(function(err, res) {
                credentialId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.gitUsername).to.be.equal(
                    gitUsername
                );
                done();
            });
    });
});
