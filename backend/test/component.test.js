/* eslint-disable */
process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
let app = require('../server');
let GlobalConfig = require('./utils/globalConfig');
let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let ComponentService = require('../backend/services/componentService');
let NotificationService = require('../backend/services/notificationService');
let AirtableService = require('../backend/services/airtableService');
const gitCredential = require('./data/gitCredential');
const GitCredentialService = require('../backend/services/gitCredentialService');
const dockerCredential = require('./data/dockerCredential');
const DockerCredentialService = require('../backend/services/dockerCredentialService');

let VerificationTokenModel = require('../backend/models/verificationToken');

let token, userId, projectId, componentId, monitorId, resourceCount = 0;

describe('Component API', function() {
    this.timeout(30000);

    before(function(done) {
        this.timeout(80000);
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
        await ProjectService.hardDeleteBy({
            _id: {
                $in: [projectId, newProjectId, otherProjectId, subProjectId],
            },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
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


    it('should reject the request of an unauthenticated user', function(done) {
        request
            .post(`/component/${projectId}`)
            .send({
                name: 'New Component',
            })
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not create a component when the `name` field is null', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/component/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new component when the correct data is given by an authenticated user', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/component/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component',
            })
            .end(function(err, res) {
                componentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component');
                done();
            });
    });

    it('should update a component when the correct data is given by an authenticated user', function(done) {
        let authorization = `Basic ${token}`;
        request
            .put(`/component/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Updated Component',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(componentId);
                done();
            });
    });

    it('should get components for an authenticated user by ProjectId', function(done) {
        let authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}/component`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get a component for an authenticated user with valid componentId', function(done) {
        let authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}/component/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body._id).to.be.equal(componentId);
                done();
            });
    });

    it('should create a new monitor when `componentId` is given`', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function(err, res) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor');
                resourceCount++; // Increment Resource Count
                done();
            });
    });

    it('should return a list of all resources under component', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}/resources/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.totalResources).to.be.an('array');
                expect(res.body.totalResources[0].type).to.be.a('string'); // type of the monitor
                expect(res.body.totalResources).to.have.lengthOf(resourceCount); // one monitor
                done();
            });
    });

    it('should create a new application log when `componentId` is given then get list of resources`', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: 'New Application Log',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Application Log');
                resourceCount++; // Increment Resource Count
                request
                    .get(`/component/${projectId}/resources/${componentId}`)
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body.totalResources).to.be.an('array');
                        expect(res.body.totalResources[1].status).to.be.a(
                            'string'
                        ); // type of the monitor
                        expect(res.body.totalResources[1].status).to.be.equal(
                            'No logs yet'
                        );
                        expect(res.body.totalResources).to.have.lengthOf(resourceCount); // one application log and one monitor
                        done();
                    });
            });
    });
    it('should create a new application log then creater a log when `componentId` is given then get list of resources`', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: 'New Application Log II',
            })
            .end(function(err, res) {
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
                    .end(function(err, res) {
                        expect(res).to.have.status(200);

                        request
                            .get(
                                `/component/${projectId}/resources/${componentId}`
                            )
                            .set('Authorization', authorization)
                            .end(function(err, res) {
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

    it('should create an application security then get list of resources', function(done) {
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
                        .end(function(err, res) {
                            expect(res).to.have.status(200);
                            expect(res.body.totalResources).to.be.an('array');
                            expect(res.body.totalResources).to.have.lengthOf(resourceCount); // two application logs, one monitor and one application log security
                            done();
                        });
                });
        }).then(done());
    });

    it('should create a container security', function(done) {
        const authorization = `Basic ${token}`;

        DockerCredentialService.create({
            dockerUsername: dockerCredential.dockerUsername,
            dockerPassword: dockerCredential.dockerPassword,
            dockerRegistryUrl: dockerCredential.dockerRegistryUrl,
            projectId,
        }).then(function(credential) {
            credentialId = credential._id;
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
                .end(function(err, res) {
                    containerSecurityId = res.body._id;
                    expect(res).to.have.status(200);
                    resourceCount++; // Increment Resource Count
                    expect(res.body.componentId).to.be.equal(componentId);
                    expect(res.body.name).to.be.equal(data.name);
                    expect(res.body.imagePath).to.be.equal(data.imagePath);
                    expect(res.body.imageTags).to.be.equal(data.imageTags);
                    request
                        .get(`/component/${projectId}/resources/${componentId}`)
                        .set('Authorization', authorization)
                        .end(function(err, res) {
                            expect(res).to.have.status(200);
                            expect(res.body.totalResources).to.be.an('array');
                            expect(res.body.totalResources).to.have.lengthOf(resourceCount); // tws application logs, one monitor, one application log security and one container security
                            done();
                        });
                });
        }).then(done());
    });

    it('should delete a component and its monitor when componentId is valid', function(done) {
        let authorization = `Basic ${token}`;
        request
            .delete(`/component/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                request
                    .get(`/monitor/${projectId}/monitor/${monitorId}`)
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.not.have.property('_id');
                        done();
                    });
            });
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId,
    newUserToken,
    newUserId,
    newProjectId,
    otherUserId,
    otherProjectId,
    subProjectComponentId,
    newComponentId;

describe('Component API with Sub-Projects', function() {
    this.timeout(30000);
    before(function(done) {
        this.timeout(30000);
        let authorization = `Basic ${token}`;
        // create a subproject for parent project
        GlobalConfig.initTestConfig().then(function() {
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end(function(err, res) {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(request, userData.newUser, function(err, res) {
                        let project = res.body.project;
                        newProjectId = project._id;
                        newUserId = res.body.id;

                        VerificationTokenModel.findOne(
                            { userId: newUserId },
                            function(err, verificationToken) {
                                request
                                    .get(
                                        `/user/confirmation/${verificationToken.token}`
                                    )
                                    .redirects(0)
                                    .end(function() {
                                        request
                                            .post('/user/login')
                                            .send({
                                                email: userData.newUser.email,
                                                password:
                                                    userData.newUser.password,
                                            })
                                            .end(function(err, res) {
                                                newUserToken =
                                                    res.body.tokens
                                                        .jwtAccessToken;
                                                let authorization = `Basic ${token}`;
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
                                                        emails:
                                                            userData.newUser
                                                                .email,
                                                        role: 'Member',
                                                    })
                                                    .end(function() {
                                                        done();
                                                    });
                                            });
                                    });
                            }
                        );
                    });
                });
        });
    });

    it('should not create a component for user not present in project', function(done) {
        createUser(request, userData.anotherUser, function(err, res) {
            let project = res.body.project;
            otherProjectId = project._id;
            otherUserId = res.body.id;

            VerificationTokenModel.findOne({ userId: otherUserId }, function(
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
                                email: userData.anotherUser.email,
                                password: userData.anotherUser.password,
                            })
                            .end(function(err, res) {
                                let authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                request
                                    .post(`/component/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send({ name: 'New Component 1' })
                                    .end(function(err, res) {
                                        expect(res).to.have.status(400);
                                        expect(res.body.message).to.be.equal(
                                            'You are not present in this project.'
                                        );
                                        done();
                                    });
                            });
                    });
            });
        });
    });

    it('should not create a component for user that is not `admin` in project.', function(done) {
        let authorization = `Basic ${newUserToken}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 1',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a component in parent project by valid admin.', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/component/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 1',
            })
            .end(function(err, res) {
                newComponentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 1');
                done();
            });
    });

    it('should not create a component with exisiting name in sub-project.', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 1',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Component with that name already exists.'
                );
                done();
            });
    });

    it('should create a component in sub-project.', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 2',
            })
            .end(function(err, res) {
                subProjectComponentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 2');
                done();
            });
    });

    it("should get only sub-project's components for valid sub-project user", function(done) {
        let authorization = `Basic ${newUserToken}`;
        request
            .get(`/component/${subProjectId}/component`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                expect(res.body.data[0]._id).to.be.equal(subProjectComponentId);
                done();
            });
    });

    it('should get both project and sub-project components for valid parent project user.', function(done) {
        let authorization = `Basic ${token}`;
        request
            .get(`/component/${projectId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('components');
                expect(res.body[0]).to.have.property('count');
                expect(res.body[0]._id).to.be.equal(subProjectId);
                expect(res.body[1]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should not delete a component for user that is not `admin` in sub-project.', function(done) {
        let authorization = `Basic ${newUserToken}`;
        request
            .delete(`/component/${subProjectId}/${subProjectComponentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project component', function(done) {
        let authorization = `Basic ${token}`;
        request
            .delete(`/component/${subProjectId}/${subProjectComponentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete project component', function(done) {
        let authorization = `Basic ${token}`;
        request
            .delete(`/component/${projectId}/${newComponentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
