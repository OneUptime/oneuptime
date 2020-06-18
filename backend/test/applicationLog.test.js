/* eslint-disable no-undef */
process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const VerificationTokenModel = require('../backend/models/verificationToken');
const ApplicationLogService = require('../backend/services/applicationLogService');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');

let token, userId, airtableId, projectId, componentId, applicationLog;
const log = {
    applicationLogKey: 'Wrong-key',
    content: 'this is a log',
    type: 'info',
};

describe('Application Log API', function() {
    this.timeout(80000);

    before(function(done) {
        this.timeout(90000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
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
                                    const authorization = `Basic ${token}`;
                                    request
                                        .post(`/component/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send({
                                            name: 'New Component',
                                        })
                                        .end(function(err, res) {
                                            componentId = res.body._id;
                                            expect(res).to.have.status(200);
                                            expect(res.body.name).to.be.equal(
                                                'New Component'
                                            );
                                            done();
                                        });
                                });
                        });
                });
            });
        });
    });

    it('should reject the request of an unauthenticated user', function(done) {
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .send({
                name: 'New Application Log',
            })
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });
    it('should reject the request of an empty application log name', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    it('should create the application log', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: 'Travis Watcher',
            })
            .end(function(err, res) {
                applicationLog = res.body;
                expect(res).to.have.status(200);
                expect(res.body).to.include({ name: 'Travis Watcher' });
                done();
            });
    });
    it('should return a list of application logs under component', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/application-log/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
    it('should not return a list of application logs under wrong component', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/application-log/${projectId}/5ee8d7cc8701d678901ab908`) // wrong component ID
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Component does not exist.'
                );
                done();
            });
    });
    it('should not create a log with wrong application key', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Log does not exist.'
                );
                done();
            });
    });
    it('should create a log with correct application log key', function(done) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.include({ content: log.content });
                expect(res.body).to.include({ type: log.type });
                expect(res.body.applicationLogId).to.include({
                    name: applicationLog.name,
                });
                done();
            });
    });
    it('should create a log with correct application log key with type error', function(done) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'error';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.include({ content: log.content });
                expect(res.body).to.include({ type: log.type });
                expect(res.body.applicationLogId).to.include({
                    name: applicationLog.name,
                });
                done();
            });
    });
    it('should not create a log with correct application log key and invalid type', function(done) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'any type';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Log Type must be of the allowed types.'
                );
                done();
            });
    });
    it('should not reset the application log key for wrong application log id', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(
                `/application-log/${projectId}/${componentId}/5ee8d7cc8701d678901ab908/reset-key`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(404);
                expect(res.body.message).to.be.equal(
                    'Application Log not found'
                );
                expect(res).to.not.have.property('id');
                expect(res).to.not.have.property('key');
                done();
            });
    });
    it('should reset the application log key', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/reset-key`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                // confirm that the new key is not the same with the old key
                expect(res.body.key).to.not.be.equal(applicationLog.key);
                // confirm the id are the same
                expect(res.body.id).to.be.equal(applicationLog.id);
                // now set the new key to our global applicationLog so other test can make use of it
                applicationLog.key = res.body.key; //
                done();
            });
    });
    it('should fetch logs related to application log', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('array');
                expect(res.body.count).to.be.equal(2);
                done();
            });
    });
    it('should fetch logs related to application log with search params', function(done) {
        const authorization = `Basic ${token}`;
        // create a log
        log.applicationLogKey = applicationLog.key;
        log.content = 'another content';
        log.type = 'warning';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end();
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ type: 'warning' })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('array');
                expect(res.body.count).to.be.equal(1);
                done();
            });
    });
    it('should fetch logs related to application log with search params related to content', function(done) {
        const authorization = `Basic ${token}`;
        // create a log
        log.applicationLogKey = applicationLog.key;
        log.content = { code: '007', name: 'james', location: 'berlin' }; // log an object of type error
        log.type = 'error';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end();
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ type: 'error' }) // filter by error
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('array');
                expect(res.body.count).to.be.equal(2);
            });
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ type: 'error', filter: 'james' }) // filter by error and keyword from content
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('array');
                expect(res.body.count).to.be.equal(1);
                done();
            });
    });
    it('should not edit an application log with empty name', function(done) {
        const newName = '';
        const authorization = `Basic ${token}`;
        request
            .put(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .send({ name: newName })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'New Application Log Name is required.'
                );
                done();
            });
    });
    it('should not edit an application log with same name as existing application log', function(done) {
        const newName = 'Astro';
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: newName,
            })
            .end(function(err, res) {
                applicationLog = res.body;
                expect(res).to.have.status(200);
                expect(res.body).to.include({ name: newName });
                request
                    .put(
                        `/application-log/${projectId}/${componentId}/${applicationLog._id}`
                    )
                    .set('Authorization', authorization)
                    .send({ name: newName })
                    .end(function(err, res) {
                        expect(res).to.have.status(400);
                        expect(res.body.message).to.be.equal(
                            'Application Log with that name already exists.'
                        );
                        done();
                    });
            });
    });
    it('should edit an application log', function(done) {
        const newName = 'Rodeo';
        const authorization = `Basic ${token}`;
        request
            .put(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .send({ name: newName })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(applicationLog.id);
                expect(res.body.name).to.be.equal(newName);
                done();
            });
    });
    it('should edit an application log but not change application log key', function(done) {
        const newName = 'Rodeo II';
        const authorization = `Basic ${token}`;
        request
            .put(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .send({ name: newName })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(applicationLog.id);
                expect(res.body.name).to.be.equal(newName);
                expect(res.body.key).to.be.equal(applicationLog.key);
                done();
            });
    });
    it('should delete an application log', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(applicationLog.id);
                expect(res.body.deleted).to.be.equal(true);
                done();
            });
    });

    // Yet to figure out how thi works

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await ApplicationLogService.hardDeleteBy({
            _id: { $in: [applicationLog._id] },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [userData.user.email],
            },
        });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });
});
