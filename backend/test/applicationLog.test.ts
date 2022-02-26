// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import VerificationTokenModel from '../backend/models/verificationToken'
import ApplicationLogService from '../backend/services/applicationLogService'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import NotificationService from '../backend/services/notificationService'
import AirtableService from '../backend/services/airtableService'

let token: $TSFixMe, userId, projectId: $TSFixMe, componentId: $TSFixMe, applicationLog: $TSFixMe;
const log = {
    applicationLogKey: 'Wrong-key',
    content: 'this is a log',
    type: 'info',
};
const logCount = {
    error: 0,
    info: 0,
    warning: 0,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Application Log API', function(this: $TSFixMe) {
    this.timeout(80000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(90000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
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
                                .end(function(err: $TSFixMe, res: $TSFixMe) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
                                    request
                                        .post(`/component/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send({
                                            name: 'New Component',
                                        })
                                        .end(function(err: $TSFixMe, res: $TSFixMe) {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject the request of an unauthenticated user', function(done: $TSFixMe) {
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .send({
                name: 'New Application Log',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(401);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject the request of an empty application log name', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: null,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create the application log', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: 'Travis Watcher',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                applicationLog = res.body;
                expect(res).to.have.status(200);
                expect(res.body).to.include({ name: 'Travis Watcher' });
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a list of application logs under component', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/application-log/${projectId}/${componentId}`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.applicationLogs).to.be.an('array');
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not return a list of application logs under wrong component', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/application-log/${projectId}/5ee8d7cc8701d678901ab908`) // wrong component ID
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Component does not exist.'
                );
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a log with wrong application key', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Log does not exist.'
                );
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a log with correct application log key', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.include({ content: log.content });
                expect(res.body).to.include({ type: log.type });
                expect(res.body.applicationLogId).to.include({
                    name: applicationLog.name,
                });
                logCount.info++;
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a log with correct application log key with type error', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'error';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.include({ content: log.content });
                expect(res.body).to.include({ type: log.type });
                expect(res.body.applicationLogId).to.include({
                    name: applicationLog.name,
                });
                logCount.error++;
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a log with correct application log key with type error and one tag', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'error';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tags' does not exist on type '{ applicat... Remove this comment to see the full error message
        log.tags = 'server-side';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.include({ content: log.content });
                expect(res.body).to.include({ type: log.type });
                expect(res.body.tags).to.be.an('array');
                expect(res.body.tags).to.have.lengthOf(1);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tags' does not exist on type '{ applicat... Remove this comment to see the full error message
                expect(res.body.tags).to.include(log.tags);
                logCount.error++;
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a log with correct application log key with type error but invalid tag', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'error';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tags' does not exist on type '{ applicat... Remove this comment to see the full error message
        log.tags = { key: 'server-side' };
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Application Log Tags must be of type String or Array of Strings'
                );
                // remove the invalid tag
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                delete log['tags'];
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a log with correct application log key with type error and 5 tags', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'error';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tags' does not exist on type '{ applicat... Remove this comment to see the full error message
        log.tags = ['server', 'side', 'monitor', 'watcher', 'testing'];
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.include({ content: log.content });
                expect(res.body).to.include({ type: log.type });
                expect(res.body.tags).to.be.an('array');
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tags' does not exist on type '{ applicat... Remove this comment to see the full error message
                expect(res.body.tags).to.have.lengthOf(log.tags.length);
                logCount.error++;
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                delete log['tags'];
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch logs related to application log with tag search params', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        // create a log
        log.applicationLogKey = applicationLog.key;
        log.content = 'another content';
        log.type = 'warning';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tags' does not exist on type '{ applicat... Remove this comment to see the full error message
        log.tags = ['server', 'side', 'monitor', 'watcher', 'testing'];
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end();
        logCount.warning++;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ filter: 'server' })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('object');
                expect(res.body.data.logs).to.be.an('array');
                expect(res.body.data.dateRange).to.be.an('object');
                expect(res.body.count).to.be.equal(3);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a log with correct application log key and invalid type', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        log.applicationLogKey = applicationLog.key;
        log.type = 'any type';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Log Type must be of the allowed types.'
                );
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not reset the application log key for wrong application log id', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(
                `/application-log/${projectId}/${componentId}/5ee8d7cc8701d678901ab908/reset-key`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(404);
                expect(res.body.message).to.be.equal(
                    'Application Log not found'
                );
                expect(res).to.not.have.property('id');
                expect(res).to.not.have.property('key');
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reset the application log key', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/reset-key`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch logs related to application log', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('object');
                expect(res.body.data.logs).to.be.an('array');
                expect(res.body.data.dateRange).to.be.an('object');
                expect(res.body.count).to.be.equal(
                    logCount.error + logCount.info + logCount.warning
                );
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch logs related to application log with search params', function(done: $TSFixMe) {
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
        logCount.warning++;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ type: 'warning' })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('object');
                expect(res.body.data.logs).to.be.an('array');
                expect(res.body.data.dateRange).to.be.an('object');
                expect(res.body.count).to.be.equal(2);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch logs related to application log with search params related to content', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        // create a log
        log.applicationLogKey = applicationLog.key;
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ code: string; name: string; location: stri... Remove this comment to see the full error message
        log.content = { code: '007', name: 'james', location: 'berlin' }; // log an object of type error
        log.type = 'error';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end();
        logCount.error++;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ type: 'error' }) // filter by error
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('object');
                expect(res.body.data.logs).to.be.an('array');
                expect(res.body.data.dateRange).to.be.an('object');
                expect(res.body.count).to.be.equal(logCount.error);
            });
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/logs`
            )
            .set('Authorization', authorization)
            .send({ type: 'error', filter: 'james' }) // filter by error and keyword from content
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('object');
                expect(res.body.data.logs).to.be.an('array');
                expect(res.body.data.dateRange).to.be.an('object');
                expect(res.body.count).to.be.equal(1);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch logs all log stat related to application log', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        // create a log
        log.applicationLogKey = applicationLog.key;
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ code: string; name: string; location: stri... Remove this comment to see the full error message
        log.content = { code: '007', name: 'james', location: 'berlin' }; // log an object of type error
        log.type = 'error';
        request
            .post(`/application-log/${applicationLog._id}/log`)
            .set('Authorization', authorization)
            .send(log)
            .end();
        logCount.error++;
        request
            .post(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}/stats`
            )
            .set('Authorization', authorization)
            .send({})
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('object');
                expect(res.body.data.all).to.be.equal(
                    logCount.error + logCount.warning + logCount.info
                ); // total logs
                expect(res.body.data.error).to.be.equal(logCount.error); // total error
                expect(res.body.data.info).to.be.equal(logCount.info); // total info
                expect(res.body.data.warning).to.be.equal(logCount.warning); // total warning
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not edit an application log with empty name', function(done: $TSFixMe) {
        const newName = '';
        const authorization = `Basic ${token}`;
        request
            .put(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .send({ name: newName })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'New Application Log Name is required.'
                );
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not edit an application log with same name as existing application log', function(done: $TSFixMe) {
        const newName = 'Astro';
        const authorization = `Basic ${token}`;
        request
            .post(`/application-log/${projectId}/${componentId}/create`)
            .set('Authorization', authorization)
            .send({
                name: newName,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                applicationLog = res.body;
                expect(res).to.have.status(200);
                expect(res.body).to.include({ name: newName });
                request
                    .put(
                        `/application-log/${projectId}/${componentId}/${applicationLog._id}`
                    )
                    .set('Authorization', authorization)
                    .send({ name: newName })
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(400);
                        expect(res.body.message).to.be.equal(
                            'Application Log with that name already exists.'
                        );
                        done();
                    });
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should edit an application log', function(done: $TSFixMe) {
        const newName = 'Rodeo';
        const authorization = `Basic ${token}`;
        request
            .put(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .send({ name: newName })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(applicationLog.id);
                expect(res.body.name).to.be.equal(newName);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should edit an application log but not change application log key', function(done: $TSFixMe) {
        const newName = 'Rodeo II';
        const authorization = `Basic ${token}`;
        request
            .put(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .send({ name: newName })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(applicationLog.id);
                expect(res.body.name).to.be.equal(newName);
                expect(res.body.key).to.be.equal(applicationLog.key);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete an application log', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(
                `/application-log/${projectId}/${componentId}/${applicationLog._id}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.id).to.be.equal(applicationLog.id);
                expect(res.body.deleted).to.be.equal(true);
                done();
            });
    });

    // Yet to figure out how thi works

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await ApplicationLogService.hardDeleteBy({
            _id: { $in: [applicationLog._id] },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [userData.user.email.toLowerCase()],
            },
        });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });
});
