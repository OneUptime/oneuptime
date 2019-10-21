/* eslint-disable */ 
process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
var app = require('../server');

var request = chai.request.agent(app);
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var MonitorService = require('../backend/services/monitorService');
var MonitorCategoryService = require('../backend/services/monitorCategoryService');
var NotificationService = require('../backend/services/notificationService');
var VerificationTokenModel = require('../backend/models/verificationToken');

var token, userId, projectId, monitorId, monitorCategoryId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};

var monitorCategory = {
    monitorCategoryName: 'New Monitor Category',
};

describe('Monitor API', function () {
    this.timeout(30000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
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
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
    });

    it('should reject the request of an unauthenticated user', function (done) {
        request.post(`/monitor/${projectId}`).send({
            name: 'New Schedule',
        }).end(function (err, res) {
            expect(res).to.have.status(401);
            done();
        });
    });

    it('should not create a monitor when the `name` field is null', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
            name: null,
            type: 'url',
            data: { url: 'http://www.tests.org' }
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not create a monitor when the `type` field is null', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
            name: 'New Monitor',
            type: null,
            data: { url: 'http://www.tests.org' }
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should not create a monitor when the `data` field is not valid', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
            name: 'New Monitor',
            type: 'url',
            data: null
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should create a new monitor when the correct data is given by an authenticated user', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            monitorId = res.body[0]._id;
            expect(res).to.have.status(200);
            expect(res.body[0].name).to.be.equal(monitor.name);
            done();
        });
    });

    it('should not create a new monitor with invalid call schedule', function (done) {
        let scheduleId = 20;
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
            name: 'New Monitor',
            type: 'url',
            callScheduleId: scheduleId,
            data: { url: 'http://www.tests.org' }
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should create a new monitor with valid call schedule', function (done) {
        let scheduleId;
        var authorization = `Basic ${token}`;
        request.post(`/schedule/${projectId}`).set('Authorization', authorization).send({
            name: 'Valid Schedule',
        }).end(function (err, res) {
            scheduleId = res.body._id;
            request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
                name: 'New Monitor',
                type: 'url',
                callScheduleId: scheduleId,
                data: { url: 'http://www.tests.org' }
            }).end(function (err, res) {
                monitorId = res.body[0]._id;
                expect(res).to.have.status(200);
                expect(res.body[0].name).to.be.equal(monitor.name);
                request.get(`/schedule/${projectId}`).set('Authorization', authorization).end(function (err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body.data[0]).to.containSubset({
                        monitorIds: [{ name: 'New Monitor' }]
                    });
                    done();
                });
            });
        });
    });

    it('should create two new monitors and add them to one call schedule', function (done) {
        let scheduleId;
        var authorization = `Basic ${token}`;
        request.post(`/schedule/${projectId}`).set('Authorization', authorization).send({
            name: 'Valid Schedule for two monitors',
        }).end(function (err, res) {
            scheduleId = res.body._id;
            request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
                name: 'New Monitor 1',
                type: 'url',
                callScheduleId: scheduleId,
                data: { url: 'http://www.tests.org' }
            }).end(function (err, res) {
                monitorId = res.body[0]._id;
                request.post(`/monitor/${projectId}`).set('Authorization', authorization).send({
                    name: 'New Monitor 2',
                    type: 'url',
                    callScheduleId: scheduleId,
                    data: { url: 'http://www.tests.org' }
                }).end(function (err, res) {
                    monitorId = res.body[0]._id;
                    request.get(`/schedule/${projectId}`).set('Authorization', authorization).end(function (err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.have.property('data');
                        expect(res.body.data[0]).to.containSubset({
                            monitorIds: [{ name: 'New Monitor 1' }, { name: 'New Monitor 2' }]
                        });
                        done();
                    });
                });
            });
        });
    });

    it('should update a monitor when the correct data is given by an authenticated user', function (done) {
        var authorization = `Basic ${token}`;
        request.put(`/monitor/${projectId}/${monitorId}`).set('Authorization', authorization).send({
            name: 'Updated Monitor',
            type: 'url',
            data: {
                url: 'https://twitter.com'
            }
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body[0]._id).to.be.equal(monitorId);
            done();
        });
    });

    it('should get monitors for an authenticated user by ProjectId', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/monitor/${projectId}/monitor`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            done();
        });
    });

    it('should get a monitor for an authenticated user with valid monitorId', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/monitor/${projectId}/monitor/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body._id).to.be.equal(monitorId);
            done();
        });
    });

    it('should delete a monitor when monitorId is valid', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/monitor/${projectId}/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });
});


describe('Monitor API with monitor Category', function () {
    this.timeout(30000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
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
                        var authorization = `Basic ${token}`;
                        request.post(`/monitorCategory/${projectId}`).set('Authorization', authorization).send(monitorCategory).end(function (err, res) {
                            monitorCategoryId = res.body._id;
                            done();
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await MonitorCategoryService.hardDeleteBy({ _id: monitorCategoryId });
    });


    it('should create a new monitor when the monitor Category is provided by an authenticated user', function (done) {
        var authorization = `Basic ${token}`;
        monitor.monitorCategoryId = monitorCategoryId;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            monitorId = res.body[0]._id;
            expect(res).to.have.status(200);
            expect(res.body[0].name).to.be.equal(monitor.name);
            expect(res.body[0].monitorCategoryId).to.be.equal(monitor.monitorCategoryId);
            done();
        });
    });
});

// eslint-disable-next-line no-unused-vars
var subProjectId, newUserToken, subProjectMonitorId;

describe('Monitor API with Sub-Projects', function () {
    this.timeout(30000);
    before(function (done) {
        this.timeout(30000);
        var authorization = `Basic ${token}`;
        // create a subproject for parent project
        request.post(`/project/${projectId}/subProject`).set('Authorization', authorization).send([{ name: 'New SubProject' }]
        ).end(function (err, res) {
            subProjectId = res.body[0]._id;
            // sign up second user (subproject user)
            request.post('/user/signup').send(userData.newUser).end(function (err, res) {
                userId = res.body.id;
                VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
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

    after(async function () {  });

    it('should not create a monitor for user not present in project', function (done) {
        request.post('/user/signup').send(userData.anotherUser).end(function (err, res) {
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.anotherUser.email,
                        password: userData.anotherUser.password
                    }).end(function (err, res) {
                        var authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                            expect(res).to.have.status(400);
                            expect(res.body.message).to.be.equal('You are not present in this project.');
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should not create a monitor for user that is not `admin` in project.', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.post(`/monitor/${subProjectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('You cannot edit the project because you\'re not an admin.');
            done();
        });
    });

    it('should create a monitor in parent project by valid admin.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            monitorId = res.body[0]._id;
            expect(res).to.have.status(200);
            expect(res.body[0].name).to.be.equal(monitor.name);
            done();
        });
    });

    it('should create a monitor in sub-project.', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${subProjectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            subProjectMonitorId = res.body[0]._id;
            expect(res).to.have.status(200);
            expect(res.body[0].name).to.be.equal(monitor.name);
            done();
        });
    });

    it('should get only sub-project\'s monitors for valid sub-project user', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.get(`/monitor/${subProjectId}/monitor`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body).to.have.property('count');
            expect(res.body.data.length).to.be.equal(res.body.count);
            expect(res.body.data[0]._id).to.be.equal(subProjectMonitorId);
            done();
        });
    });

    it('should get both project and sub-project monitors for valid parent project user.', function (done) {
        var authorization = `Basic ${token}`;
        request.get(`/monitor/${projectId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('array');
            expect(res.body[0]).to.have.property('monitors');
            expect(res.body[0]).to.have.property('count');
            expect(res.body[0]._id).to.be.equal(subProjectId);
            expect(res.body[1]._id).to.be.equal(projectId);
            done();
        });
    });

    it('should not delete a monitor for user that is not `admin` in sub-project.', function (done) {
        var authorization = `Basic ${newUserToken}`;
        request.delete(`/monitor/${subProjectId}/${subProjectMonitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('You cannot edit the project because you\'re not an admin.');
            done();
        });
    });

    it('should delete sub-project monitor', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/monitor/${subProjectId}/${subProjectMonitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });

    it('should delete project monitor', function (done) {
        var authorization = `Basic ${token}`;
        request.delete(`/monitor/${projectId}/${monitorId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });

});

describe('Monitor API - Tests Project Seats With SubProjects', function () {
    this.timeout(30000);

    var monitorDataArray = [
        { name: 'New Monitor1', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor2', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor3', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor4', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor5', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor6', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor7', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor8', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor9', type: 'url', data: { url: 'http://www.tests.org' } },
        { name: 'New Monitor10', type: 'url', data: { url: 'http://www.tests.org' } },
    ];

    before(async function () {
        this.timeout(30000);
        var authorization = `Basic ${token}`;
        await Promise.all(monitorDataArray.map(async (monitor) => {
            await request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor);
        }));
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: { $in: [projectId, subProjectId] } });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await MonitorService.hardDeleteBy({ projectId });
    });

    // project seats -> 2, monitors -> 10
    it('should not create a new monitor because project seats are filled up (project seats -> 2, monitors -> 10).', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('You can\'t add any more monitors. Please add an extra seat to add more monitors.');
            done();
        });
    });

    // project seats -> 3, monitors -> 10
    it('should add a new seat (project seats -> 3, monitors -> 10).', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}/addseat`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.text).to.be.equal('A new seat added. Now you can add a monitor');
            done();
        });
    });

    // project seats -> 3, monitors -> 11
    it('should create a monitor (project seats -> 3, monitors -> 11).', function (done) {
        var authorization = `Basic ${token}`;
        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
            monitorId = res.body[0]._id;
            expect(res).to.have.status(200);
            expect(res.body[0].name).to.be.equal(monitor.name);
            done();
        });
    });

    // project seats -> 2, monitors -> 10
    it('should delete project monitor (project seats -> 2, monitors -> 10)', async () => {
        var authorization = `Basic ${token}`;
        var res = await request.delete(`/monitor/${projectId}/${monitorId}`).set('Authorization', authorization);
        var project = await ProjectService.findOneBy({ _id: projectId });
        expect(res).to.have.status(200);
        expect(res.body.deleted).to.be.equal(true);
        expect(parseInt(project.seats)).to.be.equal(2);
    });

});

