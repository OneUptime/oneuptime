process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
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

describe('Git Credential API', function (): void {
    const timeout = 30000;
    let projectId: ObjectID, userId, token: $TSFixMe, credentialId: $TSFixMe;

    this.timeout(timeout);

    before((done: $TSFixMe): void => {
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project = res.body.project;
                    projectId = project._id;
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
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
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

    after(async (): void => {
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

    it('should add git credential', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const gitUsername: string = 'username';
        const gitPassword: string = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                credentialId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.gitUsername).to.be.equal(gitUsername);
                done();
            });
    });

    it('should update a git credential', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const newGitUsername: string = 'newusername';

        request
            .put(`/credential/${projectId}/gitCredential/${credentialId}`)
            .set('Authorization', authorization)
            .send({
                gitUsername: newGitUsername,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.gitUsername).to.be.equal(newGitUsername);
                done();
            });
    });

    it('should get all the git credentials in a project', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const gitUsername: string = 'anotherUsername';
        const gitPassword: string = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end((): void => {
                request
                    .get(`/credential/${projectId}/gitCredential`)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('array');
                        done();
                    });
            });
    });

    it('should remove a git credential', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

        request
            .delete(`/credential/${projectId}/gitCredential/${credentialId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(credentialId);
                expect(res.body.deleted).to.be.true;
                done();
            });
    });

    it('should not create git credential with an existing git user in a project', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const gitUsername: string = 'anotherUsername'; // an existing username
        const gitPassword: string = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential already exist in this project'
                );
                done();
            });
    });

    it('should not create git credential if git username is missing', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const gitUsername: string = '';
        const gitPassword: string = 'password';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
                gitPassword,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Username is required'
                );
                done();
            });
    });

    it('should not create git credential if git password is missing', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const gitUsername: string = 'username';

        request
            .post(`/credential/${projectId}/gitCredential`)
            .set('Authorization', authorization)
            .send({
                gitUsername,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Please provide a password'
                );
                done();
            });
    });

    it('should not remove a non-existing git credential', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const credentialId: string = '5e8db97b2cc46e3a229ebc62'; // non-existing credential id

        request
            .delete(`/credential/${projectId}/gitCredential/${credentialId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Git Credential not found or does not exist'
                );
                done();
            });
    });
});
