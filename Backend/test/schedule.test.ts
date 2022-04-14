process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
// let log = require('./data/log');
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ScheduleService from '../backend/services/scheduleService';
import AirtableService from '../backend/services/airtableService';

import VerificationTokenModel from '../backend/models/verificationToken';

let token: $TSFixMe, projectId: ObjectID, scheduleId: $TSFixMe, userId;

describe('Schedule API', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    projectId = res.body.project._id;
                    userId = res.body.id;

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
                                            done();
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
        await ScheduleService.hardDeleteBy({ _id: scheduleId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /schedule/:projectId/create'

    it('should reject the request of an unauthenticated user', (done: $TSFixMe): void => {
        request
            .post(`/schedule/${projectId}`)
            .send({
                name: 'New Schedule',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not create a schedule when the `name` field is null', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: null,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new schedule when `name` is given by an authenticated user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                scheduleId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should get schedules for an authenticated user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should rename a schedule when the `projectId` is valid and the `scheduleName` is given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put(`/schedule/${projectId}/${scheduleId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Renamed Schedule',
            })
            .end((err: $TSFixMe, response: $TSFixMe): void => {
                scheduleId = response.body[0]._id;
                expect(response).to.have.status(200);
                expect(response.body).to.be.an('array');
                expect(response.body[0].name).to.equal('Renamed Schedule');
                done();
            });
    });

    it('should delete a schedule when the `projectId` and `scheduleId` is valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Delete Schedule',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                request
                    .delete(`/schedule/${projectId}/${res.body._id}`)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, response: $TSFixMe): void => {
                        expect(response).to.have.status(200);
                        ScheduleService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
    });
});

let subProjectId: ObjectID,
    newUserToken: $TSFixMe,
    subProjectScheduleId: $TSFixMe;

describe('Schedule API with Sub-Projects', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(30000);
        const authorization: string = `Basic ${token}`;
        // create a subproject for parent project
        GlobalConfig.initTestConfig().then((): void => {
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(
                        request,
                        userData.newUser,
                        (err: $TSFixMe, res: $TSFixMe): void => {
                            VerificationTokenModel.findOne(
                                { userId: res.body.id },
                                (
                                    err: $TSFixMe,
                                    verificationToken: $TSFixMe
                                ) => {
                                    request
                                        .get(
                                            `/user/confirmation/${verificationToken.token}`
                                        )
                                        .redirects(0)
                                        .end((): void => {
                                            request
                                                .post('/user/login')
                                                .send({
                                                    email: userData.newUser
                                                        .email,
                                                    password:
                                                        userData.newUser
                                                            .password,
                                                })
                                                .end(
                                                    (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ) => {
                                                        newUserToken =
                                                            res.body.tokens
                                                                .jwtAccessToken;
                                                        const authorization: string = `Basic ${token}`;
                                                        // add second user to subproject
                                                        request
                                                            .post(
                                                                `/team/${subProjectId}`
                                                            )
                                                            .set(
                                                                'Authorization',
                                                                authorization
                                                            )
                                                            .send({
                                                                emails: userData
                                                                    .newUser
                                                                    .email,
                                                                role: 'Member',
                                                            })
                                                            .end((): void => {
                                                                done();
                                                            });
                                                    }
                                                );
                                        });
                                }
                            );
                        }
                    );
                });
        });
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, subProjectId] },
        });
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

    it('should not create a schedule for user not present in project', (done: $TSFixMe): void => {
        createUser(
            request,
            userData.anotherUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                VerificationTokenModel.findOne(
                    { userId: res.body.id },
                    (err: $TSFixMe, res: $TSFixMe): void => {
                        request
                            .get(`/user/confirmation/${res.token}`)
                            .redirects(0)
                            .end((): void => {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: userData.anotherUser.email,
                                        password: userData.anotherUser.password,
                                    })
                                    .end((err: $TSFixMe, res: $TSFixMe) => {
                                        const authorization: string = `Basic ${res.body.tokens.jwtAccessToken}`;
                                        request
                                            .post(`/schedule/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                name: 'Valid Schedule',
                                            })
                                            .end(
                                                (
                                                    err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) => {
                                                    expect(res).to.have.status(
                                                        400
                                                    );
                                                    expect(
                                                        res.body.message
                                                    ).to.be.equal(
                                                        'You are not present in this project.'
                                                    );
                                                    done();
                                                }
                                            );
                                    });
                            });
                    }
                );
            }
        );
    });

    it('should not create a schedule for user that is not `admin` in sub-project.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .post(`/schedule/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a schedule in parent project by valid admin.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                scheduleId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('Valid Schedule');
                done();
            });
    });

    it('should create a schedule in parent project by valid admin.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/schedule/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                subProjectScheduleId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('Valid Schedule');
                done();
            });
    });

    it("should get only sub-project's schedules for valid sub-project user", (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .get(`/schedule/${subProjectId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                done();
            });
    });

    it('should get both project and sub-project schedule for valid parent project user.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/schedule/${projectId}/schedules`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('schedules');
                expect(res.body[0]).to.have.property('count');
                expect(res.body.length).to.be.equal(2);
                expect(res.body[0]._id).to.be.equal(subProjectId);
                expect(res.body[1]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should not delete a schedule for user that is not `admin` in sub-project.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .delete(`/schedule/${subProjectId}/${subProjectScheduleId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project schedule', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/schedule/${subProjectId}/${subProjectScheduleId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete project schedule', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/schedule/${projectId}/${scheduleId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });
});
