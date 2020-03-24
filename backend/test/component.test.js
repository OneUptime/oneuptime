/* eslint-disable */
process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
let app = require('../server');

let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let ComponentService = require('../backend/services/componentService');
let NotificationService = require('../backend/services/notificationService');
let AirtableService = require('../backend/services/airtableService');

let VerificationTokenModel = require('../backend/models/verificationToken');

let token, userId, airtableId, projectId, componentId;

describe('Component API', function() {
    this.timeout(30000);

    before(function(done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

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

    it('should reject the request of an unauthenticated user', function(done) {
        request
            .post(`/component/${projectId}`)
            .send({
                name: 'New Schedule',
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
                name: null
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
                name: 'New Component 3',
            })
            .end(function(err, res) {
                componentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 3');
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

    it('should delete a component when componentId is valid', function(done) {
        let authorization = `Basic ${token}`;
        request
            .delete(`/component/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId, newUserToken, subProjectComponentId;

describe('Component API with Sub-Projects', function() {
    this.timeout(30000);
    before(function(done) {
        this.timeout(30000);
        let authorization = `Basic ${token}`;
        // create a subproject for parent project
        request
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' })
            .end(function(err, res) {
                subProjectId = res.body[0]._id;
                // sign up second user (subproject user)
                createUser(request, userData.newUser, function(err, res) {
                    userId = res.body.id;
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
                                        email: userData.newUser.email,
                                        password: userData.newUser.password,
                                    })
                                    .end(function(err, res) {
                                        newUserToken =
                                            res.body.tokens.jwtAccessToken;
                                        let authorization = `Basic ${token}`;
                                        // add second user to subproject
                                        request
                                            .post(`/team/${subProjectId}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                emails: userData.newUser.email,
                                                role: 'Member',
                                            })
                                            .end(function() {
                                                done();
                                            });
                                    });
                            });
                    });
                });
            });
    });

    after(async function() {
        await ComponentService.hardDeleteBy({ _id: componentId });
        await ComponentService.hardDeleteBy({ _id: subProjectComponentId });
    });

    it('should not create a component for user not present in project', function(done) {
        createUser(request, userData.anotherUser, function(err, res) {
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
                                email: userData.anotherUser.email,
                                password: userData.anotherUser.password,
                            })
                            .end(function(err, res) {
                                let authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                request
                                    .post(`/component/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send({ name: 'New Component 9' })
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
                name: 'New Component 10',
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
                name: 'New Component 11',
            })
            .end(function(err, res) {
                componentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 11');
                done();
            });
    });

    it('should create a component in sub-project.', function(done) {
        let authorization = `Basic ${token}`;
        request
            .post(`/component/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Component 12',
            })
            .end(function(err, res) {
                subProjectComponentId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Component 12');
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
            .delete(`/component/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
