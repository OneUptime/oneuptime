process.env['PORT'] = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
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

let token: $TSFixMe, projectId: $TSFixMe, scheduleId: $TSFixMe, userId;

describe('Schedule API', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function () {
            createUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: Response) {
                    projectId = res.body.project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        function (err: $TSFixMe, verificationToken: $TSFixMe) {
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
                                            res: Response
                                        ) {
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

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ScheduleService.hardDeleteBy({ _id: scheduleId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /schedule/:projectId/create'

    it('should reject the request of an unauthenticated user', function (done: $TSFixMe) {
        request
            .post(`/schedule/${projectId}`)
            .send({
                name: 'New Schedule',
            })
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not create a schedule when the `name` field is null', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: null,
            })
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new schedule when `name` is given by an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end(function (err: $TSFixMe, res: Response) {
                scheduleId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should get schedules for an authenticated user', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should rename a schedule when the `projectId` is valid and the `scheduleName` is given', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .put(`/schedule/${projectId}/${scheduleId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Renamed Schedule',
            })
            .end(function (err: $TSFixMe, response: $TSFixMe) {
                scheduleId = response.body[0]._id;
                expect(response).to.have.status(200);
                expect(response.body).to.be.an('array');
                expect(response.body[0].name).to.equal('Renamed Schedule');
                done();
            });
    });

    it('should delete a schedule when the `projectId` and `scheduleId` is valid', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Delete Schedule',
            })
            .end(function (err: $TSFixMe, res: Response) {
                request
                    .delete(`/schedule/${projectId}/${res.body._id}`)
                    .set('Authorization', authorization)
                    .end(function (err: $TSFixMe, response: $TSFixMe) {
                        expect(response).to.have.status(200);
                        ScheduleService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
    });
});

let subProjectId: $TSFixMe,
    newUserToken: $TSFixMe,
    subProjectScheduleId: $TSFixMe;

describe('Schedule API with Sub-Projects', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(30000);
        const authorization = `Basic ${token}`;
        // create a subproject for parent project
        GlobalConfig.initTestConfig().then(function () {
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end(function (err: $TSFixMe, res: Response) {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(
                        request,
                        userData.newUser,
                        function (err: $TSFixMe, res: Response) {
                            VerificationTokenModel.findOne(
                                { userId: res.body.id },
                                function (
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
                                                    email: userData.newUser
                                                        .email,
                                                    password:
                                                        userData.newUser
                                                            .password,
                                                })
                                                .end(function (
                                                    err: $TSFixMe,
                                                    res: Response
                                                ) {
                                                    newUserToken =
                                                        res.body.tokens
                                                            .jwtAccessToken;
                                                    const authorization = `Basic ${token}`;
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
                                                                .newUser.email,
                                                            role: 'Member',
                                                        })
                                                        .end(function () {
                                                            done();
                                                        });
                                                });
                                        });
                                }
                            );
                        }
                    );
                });
        });
    });

    after(async function () {
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

    it('should not create a schedule for user not present in project', function (done: $TSFixMe) {
        createUser(
            request,
            userData.anotherUser,
            function (err: $TSFixMe, res: Response) {
                VerificationTokenModel.findOne(
                    { userId: res.body.id },
                    function (err: $TSFixMe, res: Response) {
                        request
                            .get(`/user/confirmation/${res.token}`)
                            .redirects(0)
                            .end(function () {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: userData.anotherUser.email,
                                        password: userData.anotherUser.password,
                                    })
                                    .end(function (
                                        err: $TSFixMe,
                                        res: Response
                                    ) {
                                        const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                        request
                                            .post(`/schedule/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                name: 'Valid Schedule',
                                            })
                                            .end(function (
                                                err: $TSFixMe,
                                                res: Response
                                            ) {
                                                expect(res).to.have.status(400);
                                                expect(
                                                    res.body.message
                                                ).to.be.equal(
                                                    'You are not present in this project.'
                                                );
                                                done();
                                            });
                                    });
                            });
                    }
                );
            }
        );
    });

    it('should not create a schedule for user that is not `admin` in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/schedule/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a schedule in parent project by valid admin.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end(function (err: $TSFixMe, res: Response) {
                scheduleId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('Valid Schedule');
                done();
            });
    });

    it('should create a schedule in parent project by valid admin.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/schedule/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Valid Schedule',
            })
            .end(function (err: $TSFixMe, res: Response) {
                subProjectScheduleId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('Valid Schedule');
                done();
            });
    });

    it("should get only sub-project's schedules for valid sub-project user", function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/schedule/${subProjectId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                done();
            });
    });

    it('should get both project and sub-project schedule for valid parent project user.', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/schedule/${projectId}/schedules`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: Response) {
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

    it('should not delete a schedule for user that is not `admin` in sub-project.', function (done: $TSFixMe) {
        const authorization = `Basic ${newUserToken}`;
        request
            .delete(`/schedule/${subProjectId}/${subProjectScheduleId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project schedule', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/schedule/${subProjectId}/${subProjectScheduleId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete project schedule', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/schedule/${projectId}/${scheduleId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
