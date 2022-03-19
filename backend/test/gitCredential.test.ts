process.env.PORT = 3020;

process.env.IS_SAAS_SERVICE = true;
import chai from 'chai';
const expect = chai.expect;
import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import GitCredentialService from '../backend/services/gitCredentialService';
import AirtableService from '../backend/services/airtableService';

describe('Git Credential API', function() {
    const timeout = 30000;
    let projectId: $TSFixMe, userId, token: $TSFixMe, credentialId: $TSFixMe;

    this.timeout(timeout);

    before(function(done: $TSFixMe) {
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(
                err: $TSFixMe,
                res: Response
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    err: $TSFixMe,
                    verificationToken: $TSFixMe
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
                                .end(function(err: $TSFixMe, res: Response) {
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
            email: userData.user.email.toLowerCase(),
        });
        await GitCredentialService.hardDeleteBy({
            projectId,
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should add git credential', function(done: $TSFixMe) {
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
            .end(function(err: $TSFixMe, res: Response) {
                credentialId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.gitUsername).to.be.equal(gitUsername);
                done();
            });
    });

    it('should update a git credential', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const newGitUsername = 'newusername';

        request
            .put(`/credential/${projectId}/gitCredential/${credentialId}`)
            .set('Authorization', authorization)
            .send({
                gitUsername: newGitUsername,
            })
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                expect(res.body.gitUsername).to.be.equal(newGitUsername);
                done();
            });
    });

    it('should get all the git credentials in a project', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const gitUsername = 'anotherUsername';
        const gitPassword = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end(function() {
                request
                    .get(`/credential/${projectId}/gitCredential`)
                    .set('Authorization', authorization)
                    .end(function(err: $TSFixMe, res: Response) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('array');
                        done();
                    });
            });
    });

    it('should remove a git credential', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .delete(`/credential/${projectId}/gitCredential/${credentialId}`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(credentialId);
                expect(res.body.deleted).to.be.true;
                done();
            });
    });

    it('should not create git credential with an existing git user in a project', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const gitUsername = 'anotherUsername'; // an existing username
        const gitPassword = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential already exist in this project'
                );
                done();
            });
    });

    it('should not create git credential if git username is missing', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const gitUsername = '';
        const gitPassword = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Username is required'
                );
                done();
            });
    });

    it('should not create git credential if git password is missing', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const gitUsername = 'username';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
            })
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Please provide a password'
                );
                done();
            });
    });

    it('should not remove a non-existing git credential', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const credentialId = '5e8db97b2cc46e3a229ebc62'; // non-existing credential id

        request
            .delete(`/credential/${projectId}/gitCredential/${credentialId}`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential not found or does not exist'
                );
                done();
            });
    });
});
