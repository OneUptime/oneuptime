process.env.PORT = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ScheduledEventService from '../backend/services/scheduledEventService';
import MonitorService from '../backend/services/monitorService';
import AirtableService from '../backend/services/airtableService';

import VerificationTokenModel from '../backend/models/verificationToken';
import ComponentModel from '../backend/models/component';
import scheduledEventNoteService from '../backend/services/scheduledEventNoteService';

let token: $TSFixMe,
    userId: $TSFixMe,
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    componentId: $TSFixMe,
    monitorId: $TSFixMe,
    internalNoteId: $TSFixMe,
    investigationNoteId: $TSFixMe;

const scheduledEvent: $TSFixMe = {
    name: 'New scheduled Event',
    startDate: '2019-06-11 11:01:52.178',
    endDate: '2019-06-26 11:31:53.302',
    description: 'New scheduled Event description ',
    showEventOnStatusPage: true,
    alertSubscriber: true,
    callScheduleOnEvent: true,
    monitorDuringEvent: false,
};

const internalNote: $TSFixMe = {
    type: 'internal',
    event_state: 'update',
    content: 'This is an update for internal',
};

const updatedInternalNote: $TSFixMe = {
    type: 'internal',
    event_state: 'something new',
    content: 'Something new for new',
};

const investigationNote: $TSFixMe = {
    type: 'investigation',
    event_state: 'investigating',
    content: 'This is an investigation note',
};

const updatedInvestigationNote: $TSFixMe = {
    type: 'investigation',
    event_state: 'test',
    content: 'Just updated this note',
};

describe('Scheduled Event Note', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    userId = res.body.id;
                    projectId = project._id;

                    VerificationTokenModel.findOne(
                        { userId },
                        (err: $TSFixMe, verificationToken: $TSFixMe): void => {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end((): void => {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            const authorization: string = `Basic ${token}`;
                                            ComponentModel.create({
                                                name: 'Test Component',
                                            }).then((component: $TSFixMe) => {
                                                componentId = component._id;
                                                request
                                                    .post(
                                                        `/monitor/${projectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        name: 'New Monitor 1',
                                                        type: 'url',
                                                        data: {
                                                            url: 'http://www.tests.org',
                                                        },
                                                        componentId,
                                                    })
                                                    .end(
                                                        async (
                                                            err: $TSFixMe,
                                                            res: $TSFixMe
                                                        ): void => {
                                                            monitorId =
                                                                res.body._id;

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
                                                                    monitors: [
                                                                        monitorId,
                                                                    ],
                                                                })
                                                                .end(
                                                                    async (
                                                                        err: $TSFixMe,
                                                                        res: $TSFixMe
                                                                    ): void => {
                                                                        scheduledEventId =
                                                                            res
                                                                                .body
                                                                                ._id;

                                                                        const scheduledEventNotes: $TSFixMe =
                                                                            [];

                                                                        for (
                                                                            let i: $TSFixMe = 0;
                                                                            i <
                                                                            12;
                                                                            i++
                                                                        ) {
                                                                            scheduledEventNotes.push(
                                                                                {
                                                                                    type: 'internal',
                                                                                    event_state:
                                                                                        'update',
                                                                                    content:
                                                                                        'This is an update for internal',
                                                                                }
                                                                            );
                                                                        }

                                                                        const createdScheduledEventNotes: $TSFixMe =
                                                                            scheduledEventNotes.map(
                                                                                async (
                                                                                    scheduledEventNote: $TSFixMe
                                                                                ) => {
                                                                                    const sentRequests: $TSFixMe =
                                                                                        await request
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
                                                                    }
                                                                );
                                                        }
                                                    );
                                            });
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async (): void => {
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

    it('should get all scheduled event notes => internal notes', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should get first 10 scheduled event notes for data length 10, skip 0, limit 10 and count 12 => internal notes', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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
                expect(parseInt(res.body.count)).to.be.a('number').to.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip)).to.be.a('number').to.equal(0);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit)).to.be.a('number').to.equal(10);
                done();
            });
    });

    it('should get 2 last scheduled events notes with data length 2, skip 10, limit 10 and count 12 => internal notes', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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
                expect(parseInt(res.body.count)).to.be.a('number').to.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip)).to.be.a('number').to.equal(10);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit)).to.be.a('number').to.equal(10);
                done();
            });
    });

    it('should create a scheduled event note => internal note', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should create a scheduled event note => investigation note', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should not create a scheduled event note if any of the field is missing', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

        request
            .post(`/scheduledEvent/${projectId}/${scheduledEventId}/notes`)
            .set('Authorization', authorization)
            .send({ ...internalNote, event_state: '' })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not creat a scheduled event note if type field is not investigation or internal', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

        request
            .post(`/scheduledEvent/${projectId}/${scheduledEventId}/notes`)
            .set('Authorization', authorization)
            .send({ ...internalNote, type: 'randomType' })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should update a note => internal note', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should update a note => investigation note', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should not update a note if the scheduled event note does not exist', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const noteId: $TSFixMe = projectId;

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

    it('should delete a scheduled event note => internal note', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should delete a scheduled event note => investigation note', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

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

    it('should note delete a scheduled event note if it does not exist', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const noteId: $TSFixMe = projectId;

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
