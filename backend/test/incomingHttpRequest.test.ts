process.env.PORT = 3020;

process.env.IS_SAAS_SERVICE = true;
import chai from 'chai';
const expect = chai.expect;
import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import AirtableService from '../backend/services/airtableService';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ComponentService from '../backend/services/componentService';
import IncidentPrioritiesService from '../backend/services/incidentPrioritiesService';
import MonitorService from '../backend/services/monitorService';
import IncomingHttpRequestService from '../backend/services/incomingRequestService';
import MonitorCustomFieldService from '../backend/services/monitorCustomField';
import IncidentCustomFieldService from '../backend/services/customFieldService';
import IncidentService from '../backend/services/incidentService';
import axios from 'axios';
const {
    resolveRequest,
    internalNoteRequest,
    incidentRequest,
    incidentNoteRequest,
    acknowledgeRequest,
} = require('./data/incomingHttpRequest');

describe('Incoming HTTP Request API', function() {
    const timeout = 30000;
    let projectId: $TSFixMe,
        componentId,
        userId,
        token,
        incidentPriorityId,
        monitorId: $TSFixMe,
        requestId: $TSFixMe,
        authorization: $TSFixMe,
        createIncidentUrl: $TSFixMe,
        acknowledgeIncidentUrl: $TSFixMe,
        resolveIncidentUrl: $TSFixMe,
        incidentNoteUrl: $TSFixMe,
        internalNoteUrl: $TSFixMe;

    this.timeout(timeout);

    before(function(done: $TSFixMe) {
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(
                err: $TSFixMe,
                res: $TSFixMe
            ) {
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
                                    authorization = `Basic ${token}`;

                                    request
                                        .post(`/component/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send({ name: 'Test Component' })
                                        .end(function(
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ) {
                                            componentId = res.body._id;

                                            request
                                                .post(`/monitor/${projectId}`)
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send({
                                                    name: 'testMonitor',
                                                    criteria: {},
                                                    componentId,
                                                    projectId,
                                                    type: 'manual',
                                                    data: { description: null },
                                                    customFields: [
                                                        {
                                                            fieldName:
                                                                'monitorField',
                                                            fieldValue:
                                                                'testing',
                                                        },
                                                    ],
                                                })
                                                .end(function(
                                                    err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) {
                                                    monitorId = res.body._id;

                                                    MonitorCustomFieldService.create(
                                                        {
                                                            projectId,
                                                            fieldName:
                                                                'monitorField',
                                                            fieldType: 'text',
                                                        }
                                                    ).then(function() {
                                                        done();
                                                    });
                                                });
                                        });
                                });
                        });
                });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ projectId });
        await IncomingHttpRequestService.hardDeleteBy({ projectId });
        await MonitorCustomFieldService.hardDeleteBy({ projectId });
        await IncidentCustomFieldService.hardDeleteBy({ projectId });
        await IncidentService.hardDeleteBy({ projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should create an incoming http request (Create Incident)', function(done: $TSFixMe) {
        IncidentPrioritiesService.findOne({
            query: { projectId },
            select: '_id',
        }).then(function(priority) {
            // fetch one of the priorities
            incidentPriorityId = priority._id;
            incidentRequest.incidentPriority = incidentPriorityId;

            request
                .post(`/incoming-request/${projectId}/create-request-url`)
                .set('Authorization', authorization)
                .send(incidentRequest)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    requestId = res.body._id;
                    createIncidentUrl = res.body.url;
                    expect(res).to.have.status(200);
                    expect(res.body.name).to.be.equal(incidentRequest.name);
                    expect(res.body.filters).to.be.an('array');
                    done();
                });
        });
    });

    it('should create an incoming http request (Acknowledge Incident)', function(done: $TSFixMe) {
        request
            .post(`/incoming-request/${projectId}/create-request-url`)
            .set('Authorization', authorization)
            .send(acknowledgeRequest)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                acknowledgeIncidentUrl = res.body.url;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(acknowledgeRequest.name);
                expect(res.body.filters).to.be.an('array');
                done();
            });
    });

    it('should create an incoming http request (Resolve Incident)', function(done: $TSFixMe) {
        request
            .post(`/incoming-request/${projectId}/create-request-url`)
            .set('Authorization', authorization)
            .send(resolveRequest)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                resolveIncidentUrl = res.body.url;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(resolveRequest.name);
                expect(res.body.filters).to.be.an('array');
                done();
            });
    });

    it('should create an incoming http request (Update incident note)', function(done: $TSFixMe) {
        request
            .post(`/incoming-request/${projectId}/create-request-url`)
            .send(incidentNoteRequest)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                incidentNoteUrl = res.body.url;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(incidentNoteRequest.name);
                expect(res.body.filterMatch).to.be.equal(
                    incidentNoteRequest.filterMatch
                );
                expect(res.body.filters).to.be.an('array');
                done();
            });
    });

    it('should create an incoming http request (Update internal note)', function(done: $TSFixMe) {
        request
            .post(`/incoming-request/${projectId}/create-request-url`)
            .send(internalNoteRequest)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                internalNoteUrl = res.body.url;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(internalNoteRequest.name);
                expect(res.body.filters).to.be.an('array');
                expect(res.body.filterMatch).to.be.equal(
                    internalNoteRequest.filterMatch
                );
                done();
            });
    });

    it('should update an incoming http request', function(done: $TSFixMe) {
        const update = {
            name: 'updateName',
        };

        request
            .put(`/incoming-request/${projectId}/update/${requestId}`)
            .send(update)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(update.name);
                done();
            });
    });

    it('should list all the created incoming http request in a project', function(done: $TSFixMe) {
        incidentRequest.name = 'anotherOne';
        incidentRequest.selectAllMonitors = false;
        incidentRequest.monitors = [monitorId];
        // add one more incoming http request
        request
            .post(`/incoming-request/${projectId}/create-request-url`)
            .set('Authorization', authorization)
            .send(incidentRequest)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                requestId = res.body._id;

                request
                    .get(`/incoming-request/${projectId}/all-incoming-request`)
                    .set('Authorization', authorization)
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        expect(res.body.data).to.be.an('array');
                        done();
                    });
            });
    });

    it('should create an incident with incoming http request url', function(done: $TSFixMe) {
        axios({
            method: 'post',
            url: createIncidentUrl,
        }).then(function(res) {
            expect(res).to.have.status(200);
            expect(res.data.status).to.be.equal('success');
            expect(res.data.created_incidents).to.be.an('array');
            done();
        });
    });

    it('should acknowledge an incident with an incoming http request url', function(done: $TSFixMe) {
        axios({
            method: 'post',
            url: acknowledgeIncidentUrl,
        }).then(function(res) {
            expect(res).to.have.status(200);
            expect(res.data.status).to.be.equal('success');
            expect(res.data.acknowledged_incidents).to.be.an('array');
            done();
        });
    });

    it('should resolve an incident with an incoming http request url', function(done: $TSFixMe) {
        axios({
            method: 'post',
            url: resolveIncidentUrl,
        }).then(function(res) {
            expect(res).to.have.status(200);
            expect(res.data.status).to.be.equal('success');
            expect(res.data.resolved_incidents).to.be.an('array');
            done();
        });
    });

    it('should add incident note with an incoming http request url', function(done: $TSFixMe) {
        // it should also work for a get request
        axios({
            method: 'get',
            url: incidentNoteUrl,
        }).then(function(res) {
            expect(res).to.have.status(200);
            expect(res.data.status).to.be.equal('success');
            expect(res.data.notes_addedTo).to.be.an('array');
            done();
        });
    });

    it('should add internal note with an incoming http request url', function(done: $TSFixMe) {
        axios({
            method: 'get',
            url: internalNoteUrl,
        }).then(function(res) {
            expect(res).to.have.status(200);
            expect(res.data.status).to.be.equal('success');
            expect(res.data.notes_addedTo).to.be.an('array');
            done();
        });
    });

    it('should delete an incoming http request in project', function(done: $TSFixMe) {
        request
            .delete(`/incoming-request/${projectId}/remove/${requestId}`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(String(res.body._id)).to.be.equal(String(requestId));
                done();
            });
    });
});
