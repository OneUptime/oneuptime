process.env.PORT = 3020;
process.env.REDIS_HOST = 'redis-0.redis-cluster.default.svc.cluster.local';
process.env.REDIS_PORT = 6379;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');
var UserService = require('../backend/services/userService');
var StatusService = require('../backend/services/statusPageService');
var MonitorService = require('../backend/services/monitorService');
var ProjectService = require('../backend/services/projectService');
var AirtableService = require('../backend/services/airtableService');

var VerificationTokenModel = require('../backend/models/verificationToken');

// eslint-disable-next-line
var token, projectId, monitorId, monitorCategoryId, statusPageId, userId, airtableId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

var monitorCategory = {
    monitorCategoryName: 'New Monitor Category'
};

describe('Status API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            projectId = res.body.project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        var authorization = `Basic ${token}`;
                        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send(monitorCategory)
                            .end(function (err, res) {
                                monitorCategoryId = res.body._id;
                                monitor.monitorCategoryId = monitorCategoryId;
                                request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                                    monitorId = res.body[0]._id;
                                    done();
                                });
                            });
                    });
                });
            });
        });
    });

    after(async function () {
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await StatusService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should not add status if monitor ids is missing', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/statusPage/${projectId}`).set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });


    it('should not add status if monitor is not an array', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/statusPage/${projectId}`).set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorsId: { _id: '2121' }
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should add status', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/statusPage/${projectId}`).set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorIds: [monitorId]
            }).end(function (err, res) {
                statusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should not update status settings when domain is not string', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/statusPage/${projectId}`).set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                domain: 5,
                monitorIds: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not update status settings when domain is not valid', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/statusPage/${projectId}`).set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                domain: 'wwwtest',
                monitorIds: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should update status settings', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/statusPage/${projectId}`).set('Authorization', authorization)
            .send({
                _id: statusPageId,
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                domain: 'http://www.test.com',
                monitorIds: [monitorId]
            }).end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should return monitor category with monitors in status page data', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/statusPage/${statusPageId}`).set('Authorization', authorization)
            .send().end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res).to.be.an('object');
                expect(res.body).to.have.property('monitorIds');
                expect(res.body.monitorIds).to.be.an('array').with.length.greaterThan(0);
                expect(res.body.monitorIds[0]).to.have.property('monitorCategoryId');
                done();
            });
    });
});

// eslint-disable-next-line no-unused-vars
var subProjectId, newUserToken, anotherUserToken, subProjectStatusPageId, subProjectUserId;

describe('StatusPage API with Sub-Projects', function () {
    this.timeout(30000);
    before(function (done) {
        this.timeout(30000);
        var authorization = `Basic ${token}`;
        // create a subproject for parent project
        request.post(`/project/${projectId}/subProject`).set('Authorization', authorization).send({ subProjectName: 'New SubProject' }).end(function (err, res) {
            subProjectId = res.body._id;
            // sign up second user (subproject user)
            createUser(request, userData.newUser, function(err, res) {
                subProjectUserId = res.body.id;
                VerificationTokenModel.findOne({ userId: subProjectUserId }, function (err, verificationToken) {
                    request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                        request.post('/user/login').send({
                            email: userData.newUser.email,
                            password: userData.newUser.password
                        }).end(function (err, res) {
                            newUserToken = res.body.tokens.jwtAccessToken;
                            var authorization = `Basic ${token}`;
                            // add second user to subproject
                            request.post(`/team/${subProjectId}`).set('Authorization', authorization).send({
                                emails: userData.newUser.email,
                                role: 'Member'
                            }).end(function () {
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: { $in: [projectId, subProjectId] } });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
    });

    it('should not create a statupage for user not present in project', function (done) {
        createUser(request, userData.anotherUser, function(err, res) {
            VerificationTokenModel.findOne({ userId: res.body.id }, function (err, res) {
                request.get(`/user/confirmation/${res.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.anotherUser.email,
                        password: userData.anotherUser.password
                    }).end(function (err, res) {
                        anotherUserToken = res.body.tokens.jwtAccessToken;
                        var authorization = `Basic ${anotherUserToken}`;
                        request.post(`/statusPage/${projectId}`).set('Authorization', authorization).send({
                            links: [],
                            title: 'Status title',
                            description: 'status description',
                            copyright: 'status copyright',
                            projectId,
                            monitorIds: [monitorId]
                        }).end(function (err, res) {
                            expect(res).to.have.status(400);
                            expect(res.body.message).to.be.equal('You are not present in this project.');
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should not create a statusPage for user that is not `admin` in sub-project.', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.post(`/statusPage/${subProjectId}`).set('Authorization', authorization).send({
            links: [],
            title: 'Status title',
            description: 'status description',
            copyright: 'status copyright',
            projectId,
            monitorIds: [monitorId]
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('You cannot edit the project because you\'re not an admin.');
            done();
        });
    });

    it('should create a statusPage in parent project by valid admin.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/statusPage/${projectId}`).set('Authorization', authorization).send({
            links: [],
            title: 'Status title',
            description: 'status description',
            copyright: 'status copyright',
            projectId,
            monitorIds: [monitorId]
        }).end(function (err, res) {
            statusPageId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.title).to.be.equal('Status title');
            done();
        });
    });

    it('should create a statusPage in sub-project by valid admin.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/statusPage/${subProjectId}`).set('Authorization', authorization).send({
            links: [],
            title: 'Status title',
            description: 'status description',
            copyright: 'status copyright',
            projectId,
            monitorIds: [monitorId]
        }).end(function (err, res) {
            subProjectStatusPageId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.title).to.be.equal('Status title');
            done();
        });
    });

    it('should get only sub-project\'s statuspages for valid sub-project user', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.get(`/statusPage/${subProjectId}/statuspage`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            expect(res.body.data.length).to.be.equal(res.body.count);
            done();
        });
    });

    it('should get both project and sub-project statuspage for valid parent project user.', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/statusPage/${projectId}/statuspages`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('array');
            expect(res.body[0]).to.have.property('statusPages');
            expect(res.body[0]).to.have.property('count');
            expect(res.body.length).to.be.equal(2);
            expect(res.body[0]._id).to.be.equal(subProjectId);
            expect(res.body[1]._id).to.be.equal(projectId);
            done();
        });
    });

    it('should get status page for viewer in sub-project', function (done) {
        var authorization = `Basic ${anotherUserToken}`;
        request.post(`/team/${subProjectId}`).set('Authorization', authorization).send({
            emails: userData.anotherUser.email,
            role: 'Viewer'
        }).end(function () {
            request.get(`/statusPage/${subProjectStatusPageId}`).set('Authorization', authorization).end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('monitorIds');
                done();
            });
        });
    });

    it('should not delete a status page for user that is not `admin` in sub-project.', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.delete(`/statusPage/${subProjectId}/${subProjectStatusPageId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('You cannot edit the project because you\'re not an admin.');
            done();
        });
    });

    it('should delete sub-project status page', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/statusPage/${subProjectId}/${subProjectStatusPageId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });

    it('should delete parent project status page', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/statusPage/${projectId}/${statusPageId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });
});