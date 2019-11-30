process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');
var plans = require('../backend/config/plans').getPlans();
var log = require('./data/log');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var AirtableService = require('../backend/services/airtableService');

var VerificationTokenModel = require('../backend/models/verificationToken');

// var token, userId, projectId;
var token, projectId, subProjectId, userId, airtableId;

describe('Project API', function () {
    this.timeout(30000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        done();
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await AirtableService.deleteUser(airtableId);
    });

    // 'post /user/signup'
    it('should reject the request of an unauthenticated user', function (done) {
        request.post('/project/create').send({
            projectName: 'Test Project Name',
            planId: plans[0].planId
        }).end(function (err, res) {
            expect(res).to.have.status(401);
            done();
        });
    });

    it('should not create a project when `projectName` is not given', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/project/create').set('Authorization', authorization).send({
            projectName: null,
            planId: plans[0].planId
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not create a project when `planId` is not given', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/project/create').set('Authorization', authorization).send({
            projectName: 'Unnamed Project',
            planId: null
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should create a new project when `planId` and `projectName` is given', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/project/create').set('Authorization', authorization).send({
            projectName: 'Test Project',
            planId: plans[0].planId
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            ProjectService.hardDeleteBy({ _id: res.body._id });
            done();
        });
    });

    it('should get projects for a valid user', function (done) {
        var authorization = `Basic ${token}`;
        request.get('/project/projects').set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should reset the API key for a project given the `projectId`', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/project/create').set('Authorization', authorization).send({
            projectName: 'Token Project',
            planId: plans[0].planId
        }).end(function (err, res) {
            request.get(`/project/${res.body._id}/resetToken`).set('Authorization', authorization).end(function (err, response) {
                expect(response).to.have.status(200);
                expect(res.body.apiKey).to.not.be.equal(response.body.apiKey);
                ProjectService.hardDeleteBy({ _id: response.body._id });
                done();
            });
        });
    });

    it('should not rename a project when the `projectName` is null or invalid', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/project/${projectId}/renameProject`).set('Authorization', authorization).send({
            projectName: null,
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should rename a project when `projectName` is given', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/project/create').set('Authorization', authorization).send({
            projectName: 'Old Project',
            planId: plans[0].planId
        }).end(function (err, res) {
            request.put(`/project/${res.body._id}/renameProject`).set('Authorization', authorization).send({
                projectName: 'Renamed Project',
            }).end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.not.equal('Old Project');
                ProjectService.hardDeleteBy({ _id: res.body._id });
                done();
            });
        });
    });

    it('should delete a project when `projectId` is given', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/project/create').set('Authorization', authorization).send({
            projectName: 'To-Delete Project',
            planId: plans[0].planId
        }).end(function (err, res) {
            request.delete(`/project/${res.body._id}/deleteProject`)
                .set('Authorization', authorization).end(function (err, res) {
                    expect(res).to.have.status(200);
                    ProjectService.hardDeleteBy({ _id: res.body._id });
                    done();
                });
        });
    });

    it('should change the subscription plan of the user for a project', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/project/${projectId}/changePlan`).set('Authorization', authorization).send({
            projectName: 'New Project Name',
            planId: plans[1].planId,
            oldPlan: `${plans[0].category} ${plans[0].details}`,
            newPlan: `${plans[1].category} ${plans[1].details}`,
        }).end(function (err, response) {
            expect(response).to.have.status(200);
            expect(response.body.stripePlanId).to.be.equal(plans[1].planId);
            done();
        });
    });

    it('should remove a user from a project', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/project/${projectId}/user/${userId}/exitProject`).set('Authorization', authorization).end(function (err, res) {
            log(res.text);
            expect(res).to.have.status(200);
            expect(res.text).to.be.equal('User successfully exited the project');
            done();
        });
    });
});

describe('Projects SubProjects API', function () {
    this.timeout(30000);
    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        done();
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: { $in: [projectId, subProjectId] } });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
    });

    it('should not create a subproject without a name.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/project/${projectId}/subProject`).set('Authorization', authorization).send(
            { subProjectName: '' }
        ).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('Subproject name must be present.');
            done();
        });
    });

    it('should create a subproject.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/project/${projectId}/subProject`).set('Authorization', authorization).send(
            { subProjectName: 'New SubProject' }
        ).end(function (err, res) {
            subProjectId = res.body._id;
            expect(res).to.have.status(200);
            done();
        });
    });

    it('should not get subprojects for a user not present in the project.', function (done) {
        createUser(request, userData.newUser, function(err, res) {
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.newUser.email,
                        password: userData.newUser.password
                    }).end(function (err, res) {
                        var authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                        request.get(`/project/${projectId}/subProjects`).set('Authorization', authorization).end(function (err, res) {
                            expect(res).to.have.status(400);
                            expect(res.body.message).to.be.equal('You are not present in this project.');
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should get subprojects for a valid user.', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/project/${projectId}/subProjects`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.data).to.be.an('array');
            expect(res.body.data[0]._id).to.be.equal(subProjectId);
            done();
        });
    });

    it('should not rename a subproject when the subproject is null or invalid or empty', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/project/${projectId}/${subProjectId}/renameSubProject`).set('Authorization', authorization).send({
            subProjectName: null,
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should rename a subproject with valid name', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/project/${projectId}/${subProjectId}/renameSubProject`).set('Authorization', authorization).send({
            subProjectName: 'Renamed SubProject',
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.name).to.be.equal('Renamed SubProject');
            done();
        });
    });

    it('should delete a subproject', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/project/${projectId}/${subProjectId}/deleteSubProject`)
            .set('Authorization', authorization).end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});