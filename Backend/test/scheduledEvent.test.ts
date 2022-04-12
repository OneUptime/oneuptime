process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ScheduledEventService from '../backend/services/scheduledEventService';
import MonitorService from '../backend/services/monitorService';
import AirtableService from '../backend/services/airtableService';
import moment from 'moment';
import VerificationTokenModel from '../backend/models/verificationToken';
import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    userId,
    projectId: string,
    scheduleEventId: $TSFixMe,
    monitorId: $TSFixMe,
    componentId;

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

const ongoingScheduledEvent = {
    name: 'Ongoing Scheduled Event',
    startDate: moment().startOf('day').format(),
    endDate: moment().add(2, 'days').format(),
    description: 'Ongoing Scheduled Event description ',
    showEventOnStatusPage: true,
    alertSubscriber: true,
    callScheduleOnEvent: true,
    monitorDuringEvent: false,
};

describe('Scheduled event API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function (): void {
            createUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: $TSFixMe): void {
                    const project = res.body.project;
                    userId = res.body.id;
                    projectId = project._id;

                    VerificationTokenModel.findOne(
                        { userId },
                        function (
                            err: $TSFixMe,
                            verificationToken: $TSFixMe
                        ): void {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end(function (): void {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })
                                        .end(function (
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ) {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            const authorization = `Basic ${token}`;
                                            ComponentModel.create({
                                                name: 'Test Component',
                                            }).then(component => {
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
                                                    .end(async function (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ): void {
                                                        monitorId =
                                                            res.body._id;

                                                        const scheduledEvents =
                                                            [];

                                                        for (
                                                            let i = 0;
                                                            i < 12;
                                                            i++
                                                        ) {
                                                            scheduledEvents.push(
                                                                {
                                                                    name: `testPagination${i}`,
                                                                    description:
                                                                        'testPaginationDescription',
                                                                    startDate:
                                                                        '2019-06-11 11:01:52.178',
                                                                    endDate:
                                                                        '2019-06-26 11:31:53.302',
                                                                    monitors: [
                                                                        monitorId,
                                                                    ],
                                                                }
                                                            );
                                                        }

                                                        const createdScheduledEvents =
                                                            scheduledEvents.map(
                                                                async scheduledEvent => {
                                                                    const sentRequests =
                                                                        await request
                                                                            .post(
                                                                                `/scheduledEvent/${projectId}`
                                                                            )
                                                                            .set(
                                                                                'Authorization',
                                                                                authorization
                                                                            )
                                                                            .send(
                                                                                scheduledEvent
                                                                            );
                                                                    return sentRequests;
                                                                }
                                                            );

                                                        await Promise.all(
                                                            createdScheduledEvents
                                                        );
                                                        done();
                                                    });
                                            });
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async function (): void {
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
        await ScheduledEventService.hardDeleteBy({ projectId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not create a scheduled event when the fields are null', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: null,
                startDate: '',
                endDate: '',
                description: '',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a scheduled event when a monitor is selected multiple times', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...scheduledEvent,
                monitors: [monitorId, monitorId],
            })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a scheduled event when the start date is greater than end date', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...scheduledEvent,
                startDate: '2019-09-11 11:01:52.178',
                endDate: '2019-06-26 11:31:53.302',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new scheduled event when proper fields are given by an authenticated user', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send({ ...scheduledEvent, monitors: [monitorId] })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                scheduleEventId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(scheduledEvent.name);
                done();
            });
    });

    it('should get all scheduled events for a project', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .get(`/scheduledEvent/${projectId}/scheduledEvents/all`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body).to.have.length.greaterThan(0);
                done();
            });
    });

    it('should update a scheduled event when scheduledEventId is valid', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .put(`/scheduledEvent/${projectId}/${scheduleEventId}`)
            .set('Authorization', authorization)
            .send({
                ...scheduledEvent,
                name: 'updated name',
                monitors: [monitorId],
            })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('updated name');
                done();
            });
    });

    it('should delete a scheduled event when scheduledEventId is valid', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .delete(`/scheduledEvent/${projectId}/${scheduleEventId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should get first 10 scheduled events with data length 10, skip 0, limit 10 and count 12', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;

        request
            .get(`/scheduledEvent/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length(10);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.a('number').to.be.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip))
                    .to.be.a('number')
                    .to.be.equal(0);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit))
                    .to.be.a('number')
                    .to.be.equal(10);
                done();
            });
    });

    it('should get 2 last scheduled events with data length 2, skip 10, limit 10 and count 12', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .get(`/scheduledEvent/${projectId}?skip=10&limit=10`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length(2);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.a('number').to.be.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip))
                    .to.be.a('number')
                    .to.be.equal(10);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit))
                    .to.be.a('number')
                    .to.be.equal(10);
                done();
            });
    });

    it('should get 0 scheduled events with data length 0, skip 20, limit 10 and count 12', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .get(`/scheduledEvent/${projectId}?skip=20&limit=10`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length(0);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.an('number').to.be.equal(12);
                expect(res.body).to.have.property('skip');
                expect(parseInt(res.body.skip))
                    .to.be.an('number')
                    .to.be.equal(20);
                expect(res.body).to.have.property('limit');
                expect(parseInt(res.body.limit))
                    .to.be.an('number')
                    .to.be.equal(10);
                done();
            });
    });

    it('should fetch an onging scheduled event', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send({ ...ongoingScheduledEvent, monitors: [monitorId] })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                scheduleEventId = res.body._id;
                request
                    .get(`/scheduledEvent/${projectId}/ongoingEvent`)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        expect(res).to.have.status(200);
                        expect(res.body.data).to.be.an('array');
                        expect(String(res.body.data[0]._id)).to.be.equal(
                            String(scheduleEventId)
                        );
                        done();
                    });
            });
    });
});

describe('User from other project have access to read / write and delete API.', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function (): void {
            createUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: $TSFixMe): void {
                    const project = res.body.project;
                    projectId = project._id;
                    createUser(
                        request,
                        userData.newUser,
                        function (err: $TSFixMe, res: $TSFixMe): void {
                            userId = res.body.id;
                            VerificationTokenModel.findOne(
                                { userId },
                                function (
                                    err: $TSFixMe,
                                    verificationToken: $TSFixMe
                                ) {
                                    request
                                        .get(
                                            `/user/confirmation/${verificationToken.token}`
                                        )
                                        .redirects(0)
                                        .end(function (): void {
                                            request
                                                .post('/user/login')
                                                .send({
                                                    email: userData.newUser
                                                        .email,
                                                    password:
                                                        userData.newUser
                                                            .password,
                                                })
                                                .end(function (
                                                    err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) {
                                                    token =
                                                        res.body.tokens
                                                            .jwtAccessToken;
                                                    done();
                                                });
                                        });
                                }
                            );
                        }
                    );
                }
            );
        });
    });

    after(async function (): void {
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
    });

    it('should not be able to create new scheduled event', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .post(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .send(scheduledEvent)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not be able to delete a scheduled event', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .delete(`/scheduledEvent/${projectId}/${scheduleEventId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not be able to get all scheduled events', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .get(`/scheduledEvent/${projectId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not be able to update a scheduled event', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .put(`/scheduledEvent/${projectId}/${scheduleEventId}`)
            .set('Authorization', authorization)
            .send({
                ...scheduledEvent,
                name: 'Name update',
            })
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(400);
                done();
            });
    });
});
