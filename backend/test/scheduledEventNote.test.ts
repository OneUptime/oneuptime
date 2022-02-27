// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chai-http);
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import ScheduledEventService from '../backend/services/scheduledEventService'
import MonitorService from '../backend/services/monitorService'
import AirtableService from '../backend/services/airtableService'

import VerificationTokenModel from '../backend/models/verificationToken'
import ComponentModel from '../backend/models/component'
import scheduledEventNoteService from '../backend/services/scheduledEventNoteService'

let token: $TSFixMe,
    userId,
    projectId: $TSFixMe,
    scheduledEventId: $TSFixMe,
    componentId,
    monitorId: $TSFixMe,
    internalNoteId: $TSFixMe,
    investigationNoteId: $TSFixMe;

const scheduledEvent = {
    name: 'New scheduled Event',
    startDate: '2019-06-11 11:01:52.178',
    endDate: '2019-06-26 11:31:53.302',
    description: 'New scheduled Event description ',
    showEventOnStatusPage: true,
    alertSubscriber: true,
    callScheduleOnEvent: true,
    monitorDuringEvent: false,
};

const internalNote = {
    type: 'internal',
    event_state: 'update',
    content: 'This is an update for internal',
};

const updatedInternalNote = {
    type: 'internal',
    event_state: 'something new',
    content: 'Something new for new',
};

const investigationNote = {
    type: 'investigation',
    event_state: 'investigating',
    content: 'This is an investigation note',
};

const updatedInvestigationNote = {
    type: 'investigation',
    event_state: 'test',
    content: 'Just updated this note',
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Scheduled Event Note', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                userId = res.body.id;
                projectId = project._id;

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
                                    ComponentModel.create({
                                        name: 'Test Component',
                                    }).then(component => {
                                        componentId = component._id;
                                        request
                                            .post(`/monitor/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                name: 'New Monitor 1',
                                                type: 'url',
                                                data: {
                                                    url: 'http://www.tests.org',
                                                },
                                                componentId,
                                            })
                                            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                                                monitorId = res.body._id;

                                                request
                                                    .post(
                                                        `/scheduledEvent/${projectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        ...scheduledEvent,
                                                        monitors: [monitorId],
                                                    })
                                                    .end(async function(
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ) {
                                                        scheduledEventId =
                                                            res.body._id;

                                                        const scheduledEventNotes = [];

                                                        for (
                                                            let i = 0;
                                                            i < 12;
                                                            i++
                                                        ) {
                                                            scheduledEventNotes.push(
                                                                {
                                                                    type:
                                                                        'internal',
                                                                    event_state:
                                                                        'update',
                                                                    content:
                                                                        'This is an update for internal',
                                                                }
                                                            );
                                                        }

                                                        const createdScheduledEventNotes = scheduledEventNotes.map(
                                                            async scheduledEventNote => {
                                                                const sentRequests = await request
                                                                    .post(
                                                                        `/scheduledEvent/${projectId}/${scheduledEventId}/notes`
                                                                    )
                                                                    .set(
                                                                        'Authorization',
                                                                        authorization
                                                                    )
                                                                    .send(
                                                                        scheduledEventNote
                                                                    );
                                                                return sentRequests;
                                                            }
                                                        );

                                                        await Promise.all(
                                                            createdScheduledEventNotes
                                                        );

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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await ScheduledEventService.hardDeleteBy({
            _id: scheduledEventId,
            projectId,
        });
        await scheduledEventNoteService.hardDelete({ scheduledEventId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get all scheduled event notes => internal notes', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes?type=internal`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.a('number');
                expect(res.body.count).to.equal(12);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get first 10 scheduled event notes for data length 10, skip 0, limit 10 and count 12 => internal notes', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes?type=internal&skip=0&limit=10`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length(10);
                expect(res.body).to.have.property('count');
                expect(parseInt(res.body.count))
                    .to.be.a('number')
                    .to.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip))
                    .to.be.a('number')
                    .to.equal(0);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit))
                    .to.be.a('number')
                    .to.equal(10);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get 2 last scheduled events notes with data length 2, skip 10, limit 10 and count 12 => internal notes', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes?type=internal&skip=10&limit=10`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length(2);
                expect(res.body).to.have.property('count');
                expect(parseInt(res.body.count))
                    .to.be.a('number')
                    .to.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip))
                    .to.be.a('number')
                    .to.equal(10);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit))
                    .to.be.a('number')
                    .to.equal(10);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a scheduled event note => internal note', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .post(`/scheduledEvent/${projectId}/${scheduledEventId}/notes`)
            .set('Authorization', authorization)
            .send(internalNote)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                internalNoteId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.event_state).to.equal(internalNote.event_state);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a scheduled event note => investigation note', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .post(`/scheduledEvent/${projectId}/${scheduledEventId}/notes`)
            .set('Authorization', authorization)
            .send(investigationNote)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                investigationNoteId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.content).to.equal(investigationNote.content);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a scheduled event note if any of the field is missing', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .post(`/scheduledEvent/${projectId}/${scheduledEventId}/notes`)
            .set('Authorization', authorization)
            .send({ ...internalNote, event_state: '' })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not creat a scheduled event note if type field is not investigation or internal', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .post(`/scheduledEvent/${projectId}/${scheduledEventId}/notes`)
            .set('Authorization', authorization)
            .send({ ...internalNote, type: 'randomType' })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update a note => internal note', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .put(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes/${internalNoteId}`
            )
            .set('Authorization', authorization)
            .send(updatedInternalNote)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body.event_state).to.equal(
                    updatedInternalNote.event_state
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update a note => investigation note', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .put(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes/${investigationNoteId}`
            )
            .set('Authorization', authorization)
            .send(updatedInvestigationNote)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body.event_state).to.equal(
                    updatedInvestigationNote.event_state
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update a note if the scheduled event note does not exist', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const noteId = projectId;

        request
            .put(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes/${noteId}`
            )
            .set('Authorization', authorization)
            .send(updatedInternalNote)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a scheduled event note => internal note', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .delete(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes/${internalNoteId}`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body._id).to.equal(internalNoteId);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a scheduled event note => investigation note', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .delete(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes/${investigationNoteId}`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body._id).to.equal(investigationNoteId);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should note delete a scheduled event note if it does not exist', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const noteId = projectId;

        request
            .delete(
                `/scheduledEvent/${projectId}/${scheduledEventId}/notes/${noteId}`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });
});
