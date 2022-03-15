process.env.PORT = 3020;

process.env.IS_SAAS_SERVICE = true;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
chai.use(require('chai-subset'));
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import MonitorService from '../backend/services/monitorService';
import ResourceCategoryService from '../backend/services/resourceCategoryService';
import NotificationService from '../backend/services/notificationService';
import AirtableService from '../backend/services/airtableService';

import uuid from 'uuid';

import VerificationTokenModel from '../backend/models/verificationToken';
import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    userId: $TSFixMe,
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    resourceCategoryId: $TSFixMe,
    monitor2Id: $TSFixMe;
const httpMonitorId = uuid.v4();
const httpMonitor2Id = uuid.v4();
const resourceCategory = {
    resourceCategoryName: 'New Monitor Category',
};

let componentId: $TSFixMe;

const httpMonitorCriteria = {
    up: {
        and: [
            {
                responseType: 'responseBody',
                filter: 'notEmpty',
            },
        ],
        or: [],
        createAlert: false,
        autoAcknowledge: false,
        autoResolve: false,
    },
    degraded: {
        and: [
            {
                responseType: 'responseBody',
                filter: 'empty',
            },
        ],
        or: [],
        createAlert: true,
        autoAcknowledge: true,
        autoResolve: true,
    },
    down: {
        and: [],
        or: [
            {
                responseType: 'responseBody',
                filter: 'empty',
            },
        ],
        createAlert: true,
        autoAcknowledge: true,
        autoResolve: true,
    },
};

describe('Monitor API', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(30000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(request, userData.user, function (
                err: $TSFixMe,
                req: Response
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                ComponentModel.create({ name: 'Test Component' }, function (
                    err,
                    component
                ) {
                    componentId = component;
                    VerificationTokenModel.findOne({ userId }, function (
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
                                        email: userData.user.email,
                                        password: userData.user.password,
                                    })
                                    .end(function (
                                        err: $TSFixMe,
                                        req: Response
                                    ) {
                                        token = res.body.tokens.jwtAccessToken;
                                        done();
                                    });
                            });
                    });
                });
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await MonitorService.hardDeleteBy({ projectId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should reject the request of an unauthenticated user', function (done: $TSFixMe) {
        request
            .post(`/monitor/${projectId}`)
            .send({
                name: 'New Schedule',
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not create a monitor when the `name` field is null', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: null,
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a monitor when the `type` field is null', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 1',
                type: null,
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a monitor when the `data` field is not valid', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 2',
                type: 'url',
                data: null,
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create an agentless server monitor when identityFile authentication is selected and the `identityFile` field is not valid', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Agentless Server',
                type: 'server-monitor',
                agentlessConfig: {
                    authentication: 'identityFile',
                },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new monitor when the correct data is given by an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 3',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 3');
                done();
            });
    });

    it('should add a new site url to a monitor', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}/siteUrl/${monitorId}`)
            .set('Authorization', authorization)
            .send({
                siteUrl: 'https://twitter.com',
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(monitorId);
                expect(res.body.siteUrls).to.contain('https://twitter.com');
                done();
            });
    });

    it('should remove a site url from a monitor', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/monitor/${projectId}/siteUrl/${monitorId}`)
            .set('Authorization', authorization)
            .send({
                siteUrl: 'https://twitter.com',
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(monitorId);
                expect(res.body.siteUrls).to.not.contain('https://twitter.com');
                done();
            });
    });

    it('should not create a new monitor with invalid call schedule', function (done: $TSFixMe) {
        const scheduleId = 20;
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 4',
                type: 'url',
                callScheduleIds: [scheduleId],
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new monitor with valid call schedule', function (done: $TSFixMe) {
        let scheduleId;
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end(function (err: $TSFixMe, req: Response) {
                scheduleId = res.body._id;
                request
                    .post(`/monitor/${projectId}`)
                    .set('Authorization', authorization)
                    .send({
                        name: 'New Monitor 5',
                        type: 'url',
                        callScheduleIds: [scheduleId],
                        data: { url: 'http://www.tests.org' },
                        componentId,
                    })
                    .end(function (err: $TSFixMe, req: Response) {
                        monitorId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body.name).to.be.equal('New Monitor 5');
                        request
                            .get(`/schedule/${projectId}`)
                            .set('Authorization', authorization)
                            .end(function (err: $TSFixMe, req: Response) {
                                expect(res).to.have.status(200);
                                expect(res.body).to.be.an('object');
                                expect(res.body).to.have.property('data');
                                expect(res.body.data[0]).to.containSubset({
                                    monitorIds: [{ name: 'New Monitor 5' }],
                                });
                                done();
                            });
                    });
            });
    });

    it('should create two new monitors and add them to one call schedule', function (done: $TSFixMe) {
        let scheduleId: $TSFixMe;
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule for two monitors',
            })
            .end(function (err: $TSFixMe, req: Response) {
                scheduleId = res.body._id;
                request
                    .post(`/monitor/${projectId}`)
                    .set('Authorization', authorization)
                    .send({
                        name: 'New Monitor 6',
                        type: 'url',
                        callScheduleIds: [scheduleId],
                        data: { url: 'http://www.tests.org' },
                        componentId,
                    })
                    .end(function (err: $TSFixMe, req: Response) {
                        monitorId = res.body._id;
                        request
                            .post(`/monitor/${projectId}`)
                            .set('Authorization', authorization)
                            .send({
                                name: 'New Monitor 7',
                                type: 'url',
                                callScheduleIds: [scheduleId],
                                data: { url: 'http://www.tests.org' },
                                componentId,
                            })
                            .end(function (err: $TSFixMe, req: Response) {
                                monitorId = res.body._id;
                                request
                                    .get(`/schedule/${projectId}`)
                                    .set('Authorization', authorization)
                                    .end(function (
                                        err: $TSFixMe,
                                        req: Response
                                    ) {
                                        expect(res).to.have.status(200);
                                        expect(res.body).to.be.an('object');
                                        expect(res.body).to.have.property(
                                            'data'
                                        );
                                        expect(
                                            res.body.data[0]
                                        ).to.containSubset({
                                            monitorIds: [
                                                { name: 'New Monitor 6' },
                                                { name: 'New Monitor 7' },
                                            ],
                                        });
                                        done();
                                    });
                            });
                    });
            });
    });

    it('should update a monitor when the correct data is given by an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .put(`/monitor/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Updated Monitor',
                type: 'url',
                data: {
                    url: 'https://twitter.com',
                },
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body._id).to.be.equal(monitorId);
                done();
            });
    });

    it('should get monitors for an authenticated user by ProjectId', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/monitor/${projectId}/monitor`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get a monitor for an authenticated user with valid monitorId', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/monitor/${projectId}/monitor/${monitorId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body._id).to.be.equal(monitorId);
                done();
            });
    });

    it('should delete a monitor when monitorId is valid', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/monitor/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                done();
            });
    });
});

const BACKEND_URL = `http://localhost:${process.env.PORT}/api`;
const HTTP_TEST_SERVER_URL = 'http://localhost:3010';

const testServer = chai.request(HTTP_TEST_SERVER_URL);

describe('API Monitor API', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(30000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(request, userData.user, function (
                err: $TSFixMe,
                req: Response
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                ComponentModel.create({ name: 'Test Component' }, function (
                    err,
                    component
                ) {
                    componentId = component;
                    VerificationTokenModel.findOne({ userId }, function (
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
                                        email: userData.user.email,
                                        password: userData.user.password,
                                    })
                                    .end(function (
                                        err: $TSFixMe,
                                        req: Response
                                    ) {
                                        token = res.body.tokens.jwtAccessToken;
                                        testServer
                                            .post('/api/settings')
                                            .send({
                                                responseTime: 0,
                                                statusCode: 200,
                                                responseType: 'json',
                                                header:
                                                    '{"Content-Type":"application/json"}',
                                                body: '{"status":"ok"}',
                                            })
                                            .end(async () => {
                                                done();
                                            });
                                    });
                            });
                    });
                });
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({
            email: userData.user.email,
        });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not add API monitor with invalid website url', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'get',
                data: { url: 'https://google.com' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'API Monitor URL should not be a HTML page.'
                );
                done();
            });
    });

    it('should not add API monitor with invalid url', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'post',
                data: { url: `https://oneuptime.com/api/monitor/${projectId}` },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not add API monitor with empty or invalid header', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'post',
                data: { url: `${BACKEND_URL}/monitor/${projectId}` },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Unauthorized');
                done();
            });
    });

    it('should not add API monitor with empty body', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'post',
                headers: [{ key: 'Authorization', value: authorization }],
                data: { url: `${BACKEND_URL}/monitor/${projectId}` },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Bad Request');
                done();
            });
    });

    it('should not add API monitor with invalid body', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'post',
                bodyType: 'text/plain',
                text: 'BAD',
                headers: [{ key: 'Authorization', value: authorization }],
                data: { url: `${BACKEND_URL}/monitor/${projectId}` },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Bad Request');
                done();
            });
    });

    it('should add API monitor with valid url', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'get',
                data: { url: HTTP_TEST_SERVER_URL },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 30');
                done();
            });
    });

    it('should not edit API monitor with invalid url', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .put(`/monitor/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 30',
                type: 'api',
                method: 'get',
                data: { url: 'https://google.com' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'API Monitor URL should not be a HTML page.'
                );
                done();
            });
    });
});

describe('IncomingHttpRequest Monitor', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(30000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(request, userData.user, function (
                err: $TSFixMe,
                req: Response
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                ComponentModel.create({ name: 'Test Component' }, function (
                    err,
                    component
                ) {
                    componentId = component;
                    VerificationTokenModel.findOne({ userId }, function (
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
                                        email: userData.user.email,
                                        password: userData.user.password,
                                    })
                                    .end(function (
                                        err: $TSFixMe,
                                        req: Response
                                    ) {
                                        token = res.body.tokens.jwtAccessToken;
                                        done();
                                    });
                            });
                    });
                });
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitor2Id });
        await UserService.hardDeleteBy({
            email: userData.user.email,
        });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should create a new IncomingHttpRequest monitor', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 120',
                projectId,
                criteria: httpMonitorCriteria,
                type: 'incomingHttpRequest',
                data: {
                    link: `${global.apiHost}/incomingHttpRequest/${httpMonitorId}`,
                },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 120');
                done();
            });
    });

    it('should report monitor degraded when api has no body in post request', function (done: $TSFixMe) {
        request
            .post(`/incomingHttpRequest/${httpMonitorId}`)
            .send({})
            .end(function (err: $TSFixMe, req: Response) {
                expect(res.body.monitorId).to.be.equal(monitorId);
                expect(res.body.status).to.be.equal('degraded');
                done();
            });
    });

    it('should report monitor degraded when api has no body in get request', function (done: $TSFixMe) {
        request
            .get(`/incomingHttpRequest/${httpMonitorId}`)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res.body.monitorId).to.be.equal(monitorId);
                expect(res.body.status).to.be.equal('degraded');
                done();
            });
    });

    it('should report monitor up when api has a valid body in post request', function (done: $TSFixMe) {
        request
            .post(`/incomingHttpRequest/${httpMonitorId}`)
            .send({ id: '123456' })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res.body.monitorId).to.be.equal(monitorId);
                expect(res.body.status).to.be.equal('online');
                done();
            });
    });

    it('should report monitor up when api has a valid body in get request', function (done: $TSFixMe) {
        request
            .get(`/incomingHttpRequest/${httpMonitorId}`)
            .send({ id: '123456' })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res.body.monitorId).to.be.equal(monitorId);
                expect(res.body.status).to.be.equal('online');
                done();
            });
    });

    it('should create a new IncomingHttpRequest monitor with query params and request headers', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const criteria = { ...httpMonitorCriteria };
        criteria.up.and.push({
            responseType: 'queryString',
            filter: 'contains',

            field1: 'abc=xyz',
        });
        criteria.up.and.push({
            responseType: 'headers',
            filter: 'contains',

            field1: 'Cache-Control=no-cache',
        });

        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 121',
                projectId,
                criteria: criteria,
                type: 'incomingHttpRequest',
                data: {
                    link: `${global.apiHost}/incomingHttpRequest/${httpMonitor2Id}`,
                },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                monitor2Id = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 121');
                done();
            });
    });

    it('should report monitor offline when api has no query param and request headers in post request', function (done: $TSFixMe) {
        request
            .post(`/incomingHttpRequest/${httpMonitor2Id}`)
            .send({ id: '123456' })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res.body.monitorId).to.be.equal(monitor2Id);
                expect(res.body.status).to.be.equal('offline');
                done();
            });
    });

    it('should report monitor up when api has the query param and request headers', function (done: $TSFixMe) {
        request
            .post(`/incomingHttpRequest/${httpMonitor2Id}?abc=xyz`)
            .set('Cache-Control', 'no-cache')
            .send({ id: '123456' })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res.body.monitorId).to.be.equal(monitor2Id);
                expect(res.body.status).to.be.equal('online');
                done();
            });
    });
});

describe('Monitor API with resource Category', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(request, userData.user, function (
                err: $TSFixMe,
                req: Response
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;
                VerificationTokenModel.findOne({ userId }, function (
                    err: $TSFixMe,
                    verificationToken: $TSFixMe
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function () {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end(function (err: $TSFixMe, req: Response) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
                                    request
                                        .post(`/resourceCategory/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send(resourceCategory)
                                        .end(function (
                                            err: $TSFixMe,
                                            req: Response
                                        ) {
                                            resourceCategoryId = res.body._id;
                                            done();
                                        });
                                });
                        });
                });
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should create a new monitor when the resource Category is provided by an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 8',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                resourceCategory: resourceCategoryId,
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 8');
                expect(res.body.resourceCategory._id).to.be.equal(
                    resourceCategoryId
                );
                done();
            });
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId: $TSFixMe,
    newUserToken: $TSFixMe,
    subProjectMonitorId: $TSFixMe;

describe('Monitor API with Sub-Projects', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        GlobalConfig.initTestConfig().then(function () {
            const authorization = `Basic ${token}`;
            // create a subproject for parent project
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end(function (err: $TSFixMe, req: Response) {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(request, userData.newUser, function (
                        err: $TSFixMe,
                        req: Response
                    ) {
                        userId = res.body.id;
                        VerificationTokenModel.findOne({ userId }, function (
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
                                            email: userData.newUser.email,
                                            password: userData.newUser.password,
                                        })
                                        .end(function (
                                            err: $TSFixMe,
                                            req: Response
                                        ) {
                                            newUserToken =
                                                res.body.tokens.jwtAccessToken;
                                            const authorization = `Basic ${token}`;
                                            // add second user to subproject
                                            request
                                                .post(`/team/${subProjectId}`)
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send({
                                                    emails:
                                                        userData.newUser.email,
                                                    role: 'Member',
                                                })
                                                .end(function () {
                                                    done();
                                                });
                                        });
                                });
                        });
                    });
                });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await MonitorService.hardDeleteBy({ _id: subProjectMonitorId });
    });

    it('should not create a monitor for user not present in project', function (done: $TSFixMe) {
        createUser(request, userData.anotherUser, function (
            err: $TSFixMe,
            req: Response
        ) {
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (
                err: $TSFixMe,
                verificationToken: $TSFixMe
            ) {
                request
                    .get(`/user/confirmation/${verificationToken.token}`)
                    .redirects(0)
                    .end(function () {
                        request
                            .post('/user/login')
                            .send({
                                email: userData.anotherUser.email,
                                password: userData.anotherUser.password,
                            })
                            .end(function (err: $TSFixMe, req: Response) {
                                const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                request
                                    .post(`/monitor/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send({
                                        name: 'New Monitor 9',
                                        type: 'url',
                                        data: { url: 'http://www.tests.org' },
                                        componentId,
                                    })
                                    .end(function (
                                        err: $TSFixMe,
                                        req: Response
                                    ) {
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

    it('should not create a monitor for user that is not `admin` in project.', function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/monitor/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 10',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a monitor in parent project by valid admin.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 11',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                monitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 11');
                done();
            });
    });

    it('should create a monitor in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/monitor/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 12',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                subProjectMonitorId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('New Monitor 12');
                done();
            });
    });

    it("should get only sub-project's monitors for valid sub-project user", function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/monitor/${subProjectId}/monitor`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                expect(res.body.data[0]._id).to.be.equal(subProjectMonitorId);
                done();
            });
    });

    it('should get both project and sub-project monitors for valid parent project user.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('monitors');
                expect(res.body[0]).to.have.property('count');
                expect(res.body[0]._id).to.be.equal(subProjectId);
                expect(res.body[1]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should not delete a monitor for user that is not `admin` in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .delete(`/monitor/${subProjectId}/${subProjectMonitorId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project monitor', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/monitor/${subProjectId}/${subProjectMonitorId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete project monitor', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/monitor/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(200);
                done();
            });
    });
});

describe('Monitor API - Tests Project Seats With SubProjects', function () {
    this.timeout(30000);

    const monitorDataArray = [
        {
            name: 'New Monitor1',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor2',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor3',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor4',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor5',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor6',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor7',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor8',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor9',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
        {
            name: 'New Monitor10',
            type: 'url',
            data: { url: 'http://www.tests.org' },
        },
    ];

    before(async function () {
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
        const authorization = `Basic ${token}`;

        await MonitorService.hardDeleteBy({ projectId });

        await Promise.all(
            monitorDataArray.map(async monitor => {
                await request
                    .post(`/monitor/${projectId}`)
                    .set('Authorization', authorization)
                    .send({ ...monitor, componentId });
            })
        );
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, subProjectId] },
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
        await MonitorService.hardDeleteBy({ projectId });
    });

    it('should not create a new monitor because the monitor count limit is reached (Startup Plan -> 5 monitors/user).', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'New Monitor 13',
                type: 'url',
                data: { url: 'http://www.tests.org' },
                componentId,
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You can't add any more monitors. Please upgrade your account."
                );
                done();
            });
    });

    it('should be able to create more monitor on upgrade of project to Growth plan.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const growthPlan = 'plan_GoWKgxRnPPBJWy';

        const project = ProjectService.changePlan(
            projectId,
            userId,
            growthPlan
        );

        if (project) {
            request
                .post(`/monitor/${projectId}`)
                .set('Authorization', authorization)
                .send({
                    name: 'New Monitor 15',
                    type: 'url',
                    data: { url: 'http://www.tests.org' },
                    componentId,
                })
                .end(function (err: $TSFixMe, req: Response) {
                    monitorId = res.body._id;
                    expect(res).to.have.status(200);
                    expect(res.body.name).to.be.equal('New Monitor 15');
                    done();
                });
        }
    });

    /* it('should not create monitor if componentId is not provided', function(done) {
        let authorization = `Basic ${token}`;

        request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Random Monitor',
                type: 'url',
                data: { url: 'http://www.tests.org' },
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Component ID is required.'
                );
                done();
            });
    });*/

    it('should delete a monitor', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .delete(`/monitor/${projectId}/${monitorId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
    });
});
