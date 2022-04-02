process.env['PORT'] = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import chaiSubset from 'chai-subset';
chai.use(chaiSubset);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ComponentService from '../backend/services/componentService';
import NotificationService from '../backend/services/notificationService';
import AirtableService from '../backend/services/airtableService';
import gitCredential from './data/gitCredential';
import GitCredentialService from '../backend/services/gitCredentialService';
import dockerCredential from './data/dockerCredential';
import DockerCredentialService from '../backend/services/dockerCredentialService';

import VerificationTokenModel from '../backend/models/verificationToken';

let token: $TSFixMe,
    userId,
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    monitorId: $TSFixMe,
    resourceCount = 0;

describe('Component API', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(80000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: $TSFixMe) {
                    const project = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        function (err: $TSFixMe, verificationToken: $TSFixMe) {
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
                                            password: userData.user.password,
                                        })
                                        .end(function (
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ) {
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

    it('should reject the request of an unauthenticated user', function (done: $TSFixMe) {
        request
            .post(`/component/${projectId}`)
            .send({
                name: 'New Component',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not create a component when the `name` field is null', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/component/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: null,
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new component when the correct data is given by an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/component/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                componentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component');
                done();
            });
    });

    it('should update a component when the correct data is given by an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .put(`/component/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Updated Component',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(componentId);
                done();
            });
    });

    it('should get components for an authenticated user by ProjectId', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}/component`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get a component for an authenticated user with valid componentId', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}/component/${componentId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body._id).to.be.equal(componentId);
                done();
            });
    });

    it('should create a new monitor when `componentId` is given`', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor');
                resourceCount++; // Increment Resource Count
                done();
            });
    });

    it('should return a list of all resources under component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}/resources/${componentId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.totalResources).to.be.an('array');
                expect(res.body.totalResources[0].type).to.be.a('string'); // type of the monitor
                expect(res.body.totalResources).to.have.lengthOf(resourceCount); // one monitor
                done();
            });
    });

    it('should create a new application log when `componentId` is given then get list of resources`', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: 'New Application Log',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Application Log');
                resourceCount++; // Increment Resource Count
                request
                    .get(`/component/${projectId}/resources/${componentId}`)
                    .set('Authorization', authorization)
                    .end(function (err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        expect(res.body.totalResources).to.be.an('array');
                        expect(res.body.totalResources[1].status).to.be.a(
                            'string'
                        ); // type of the monitor
                        expect(res.body.totalResources[1].status).to.be.equal(
                            'No logs yet'
                        );
                        expect(res.body.totalResources).to.have.lengthOf(
                            resourceCount
                        ); // one application log and one monitor
                        done();
                    });
            });
    });

    it('should create a new application log then creater a log when `componentId` is given then get list of resources`', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: 'New Application Log II',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                resourceCount++; // Increment Resource Count
                expect(res.body.name).to.be.equal('New Application Log II');
                const log = {
                    applicationLogKey: res.body.key,
                    content: 'this is a log',
                    type: 'info',
                };
                request
                    .post(`/application-log/${res.body._id}/log`)
                    .set('Authorization', authorization)
                    .send(log)
                    .end(function (err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);

                        request
                            .get(
                                `/component/${projectId}/resources/${componentId}`
                            )
                            .set('Authorization', authorization)
                            .end(function (err: $TSFixMe, res: $TSFixMe) {
                                expect(res).to.have.status(200);
                                expect(res.body.totalResources).to.be.an(
                                    'array'
                                );
                                expect(
                                    res.body.totalResources[2].status
                                ).to.be.a('string'); // type of the monitor
                                expect(
                                    res.body.totalResources[2].status
                                ).to.be.equal('Collecting Logs');
                                expect(
                                    res.body.totalResources
                                ).to.have.lengthOf(resourceCount); // two application logs and one monitor
                                done();
                            });
                    });
            });
    });

    it('should create an application security then get list of resources', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        GitCredentialService.create({
            gitUsername: gitCredential.gitUsername,
            gitPassword: gitCredential.gitPassword,
            projectId,
        }).then(function (credential) {
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
                    expect(res).to.have.status(200);
                    resourceCount++; // Increment Resource Count
                    expect(res.body.componentId).to.be.equal(componentId);
                    expect(res.body.name).to.be.equal(data.name);
                    expect(res.body.gitRepositoryUrl).to.be.equal(
                        data.gitRepositoryUrl
                    );
                    expect(String(res.body.gitCredential)).to.be.equal(
                        String(data.gitCredential)
                    );
                    request
                        .get(`/component/${projectId}/resources/${componentId}`)
                        .set('Authorization', authorization)
                        .end(function (err: $TSFixMe, res: $TSFixMe) {
                            expect(res).to.have.status(200);
                            expect(res.body.totalResources).to.be.an('array');
                            expect(res.body.totalResources).to.have.lengthOf(
                                resourceCount
                            ); // two application logs, one monitor and one application log security
                            done();
                        });
                });
        });
    });

    it('should create a container security', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        DockerCredentialService.create({
            dockerUsername: dockerCredential.dockerUsername,
            dockerPassword: dockerCredential.dockerPassword,
            dockerRegistryUrl: dockerCredential.dockerRegistryUrl,
            projectId,
        }).then(function (credential) {
            const data = {
                name: 'Test Container',
                dockerCredential: credential._id,
                imagePath: dockerCredential.imagePath,
                imageTags: dockerCredential.imageTags,
            };

            request
                .post(`/security/${projectId}/${componentId}/container`)
                .set('Authorization', authorization)
                .send(data)
                .end(function (err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(200);
                    resourceCount++; // Increment Resource Count
                    expect(res.body.componentId).to.be.equal(componentId);
                    expect(res.body.name).to.be.equal(data.name);
                    expect(res.body.imagePath).to.be.equal(data.imagePath);
                    expect(res.body.imageTags).to.be.equal(data.imageTags);
                    request
                        .get(`/component/${projectId}/resources/${componentId}`)
                        .set('Authorization', authorization)
                        .end(function (err: $TSFixMe, res: $TSFixMe) {
                            expect(res).to.have.status(200);
                            expect(res.body.totalResources).to.be.an('array');
                            expect(res.body.totalResources).to.have.lengthOf(
                                resourceCount
                            ); // tws application logs, one monitor, one application log security and one container security
                            done();
                        });
                });
        });
    });

    it('should delete a component and its monitor when componentId is valid', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/component/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                request
                    .get(`/monitor/${projectId}/monitor/${monitorId}`)
                    .set('Authorization', authorization)
                    .end(function (err: $TSFixMe, res: $TSFixMe) {
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.not.have.property('_id');
                        done();
                    });
            });
    });
});

let subProjectId: $TSFixMe,
    newUserToken: $TSFixMe,
    newUserId,
    newProjectId: $TSFixMe,
    otherUserId,
    otherProjectId: $TSFixMe,
    subProjectComponentId: $TSFixMe,
    newComponentId: $TSFixMe;

describe('Component API with Sub-Projects', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(30000);
        const authorization = `Basic ${token}`;
        // create a subproject for parent project
        GlobalConfig.initTestConfig().then(function () {
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end(function (err: $TSFixMe, res: $TSFixMe) {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(
                        request,
                        userData.newUser,
                        function (err: $TSFixMe, res: $TSFixMe) {
                            const project = res.body.project;
                            newProjectId = project._id;
                            newUserId = res.body.id;

                            VerificationTokenModel.findOne(
                                { userId: newUserId },
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
                                                    email: userData.newUser
                                                        .email,
                                                    password:
                                                        userData.newUser
                                                            .password,
                                                })
                                                .end(function (
                                                    err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) {
                                                    newUserToken =
                                                        res.body.tokens
                                                            .jwtAccessToken;
                                                    const authorization = `Basic ${token}`;
                                                    // add second user to subproject
                                                    request
                                                        .post(
                                                            `/team/${subProjectId}`
                                                        )
                                                        .set(
                                                            'Authorization',
                                                            authorization
                                                        )
                                                        .send({
                                                            emails: userData
                                                                .newUser.email,
                                                            role: 'Member',
                                                        })
                                                        .end(function () {
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
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: {
                $in: [projectId, newProjectId, otherProjectId, subProjectId],
            },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await ComponentService.hardDeleteBy({
            _id: { $in: [componentId, newComponentId, subProjectComponentId] },
        });
        await NotificationService.hardDeleteBy({
            projectId: {
                $in: [projectId, newProjectId, otherProjectId, subProjectId],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not create a component for user not present in project', function (done: $TSFixMe) {
        createUser(
            request,
            userData.anotherUser,
            function (err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                otherProjectId = project._id;
                otherUserId = res.body.id;

                VerificationTokenModel.findOne(
                    { userId: otherUserId },
                    function (err: $TSFixMe, verificationToken: $TSFixMe) {
                        request
                            .get(
                                `/user/confirmation/${verificationToken.token}`
                            )
                            .redirects(0)
                            .end(function () {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: userData.anotherUser.email,
                                        password: userData.anotherUser.password,
                                    })
                                    .end(function (
                                        err: $TSFixMe,
                                        res: $TSFixMe
                                    ) {
                                        const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                        request
                                            .post(`/component/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({ name: 'New Component 1' })
                                            .end(function (
                                                err: $TSFixMe,
                                                res: $TSFixMe
                                            ) {
                                                expect(res).to.have.status(400);
                                                expect(
                                                    res.body.message
                                                ).to.be.equal(
                                                    'You are not present in this project.'
                                                );
                                                done();
                                            });
                                    });
                            });
                    }
                );
            }
        );
    });

    it('should not create a component for user that is not `admin` in project.', function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 1',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a component in parent project by valid admin.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/component/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 1',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                newComponentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 1');
                done();
            });
    });

    it('should not create a component with exisiting name in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 1',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Component with that name already exists.'
                );
                done();
            });
    });

    it('should create a component in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 2',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                subProjectComponentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 2');
                done();
            });
    });

    it("should get only sub-project's components for valid sub-project user", function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/component/${subProjectId}/component`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                expect(res.body.data[0]._id).to.be.equal(subProjectComponentId);
                done();
            });
    });

    it('should get project components for valid parent project user.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('components');
                expect(res.body[0]).to.have.property('count');
                expect(res.body[0]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should get sub-project components for valid parent project user.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('components');
                expect(res.body[0]).to.have.property('count');
                expect(res.body[0]._id).to.be.equal(subProjectId);
                done();
            });
    });

    it('should not delete a component for user that is not `admin` in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .delete(`/component/${subProjectId}/${subProjectComponentId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/component/${subProjectId}/${subProjectComponentId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete project component', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/component/${projectId}/${newComponentId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
