process.env['PORT'] = 3020;
process.env['NODE_ENV'] = 'development';
import userData from './data/user';
import incidentData from './data/incident';
import chai, { expect } from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import UserModel from '../backend/models/user';
import IncidentService from '../backend/services/incidentService';
import GlobalConfig from './utils/globalConfig';
import ProjectService from '../backend/services/projectService';
import StatusPageService from '../backend/services/statusPageService';
import MonitorService from '../backend/services/monitorService';
import AlertService from '../backend/services/alertService';
import AirtableService from '../backend/services/airtableService';
import NotificationService from '../backend/services/notificationService';
import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    userId: ObjectID,
    projectId: ObjectID,
    subProjectId: ObjectID,
    incidentId: $TSFixMe,
    alertId: $TSFixMe,
    monitorId: $TSFixMe;

const monitor: $TSFixMe = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Alert API', (): void => {
    after(async (): void => {
        await UserService.hardDeleteBy({});
    });

    describe('Alert API without subprojects', function (): void {
        this.timeout(30000);

        before(function (done: $TSFixMe): void {
            this.timeout(30000);
            GlobalConfig.initTestConfig().then((): void => {
                createUser(
                    request,
                    userData.user,
                    (err: $TSFixMe, res: $TSFixMe): void => {
                        const project: $TSFixMe = res.body.project;
                        projectId = project._id;
                        userId = res.body.id;

                        ComponentModel.create({ name: 'Test Component' }).then(
                            (component: $TSFixMe) => {
                                UserModel.findByIdAndUpdate(
                                    userId,
                                    { $set: { isVerified: true } },
                                    (): void => {
                                        request
                                            .post('/user/login')
                                            .send({
                                                email: userData.user.email,
                                                password:
                                                    userData.user.password,
                                            })
                                            .end(
                                                (
                                                    err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) => {
                                                    token =
                                                        res.body.tokens
                                                            .jwtAccessToken;
                                                    const authorization: string = `Basic ${token}`;
                                                    request
                                                        .post(
                                                            `/monitor/${projectId}`
                                                        )
                                                        .set(
                                                            'Authorization',
                                                            authorization
                                                        )
                                                        .send({
                                                            ...monitor,
                                                            componentId:
                                                                component._id,
                                                        })
                                                        .end(
                                                            (
                                                                err: $TSFixMe,
                                                                res: $TSFixMe
                                                            ) => {
                                                                monitorId =
                                                                    res.body
                                                                        ._id;
                                                                incidentData.monitors =
                                                                    [monitorId];
                                                                expect(
                                                                    res
                                                                ).to.have.status(
                                                                    200
                                                                );
                                                                expect(
                                                                    res.body
                                                                        .name
                                                                ).to.be.equal(
                                                                    monitor.name
                                                                );

                                                                done();
                                                            }
                                                        );
                                                }
                                            );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });

        after(async (): void => {
            await StatusPageService.hardDeleteBy({ projectId: projectId });
            await NotificationService.hardDeleteBy({ projectId: projectId });
            await AlertService.hardDeleteBy({ _id: alertId });
            GlobalConfig.removeTestConfig();
            await AirtableService.deleteAll({ tableName: 'User' });
            await UserService.hardDeleteBy({
                email: userData.user.email,
            });
        });

        // 'post /:projectId'

        it('should register with valid projectId, monitorId, incidentId, alertVia', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .post(`/incident/${projectId}/create-incident`)
                .set('Authorization', authorization)
                .send(incidentData)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    incidentId = res.body._id;
                    monitorId = res.body.monitors[0].monitorId._id;
                    request
                        .post(`/alert/${res.body.projectId._id}`)
                        .set('Authorization', authorization)
                        .send({
                            monitorId,
                            alertVia: 'email',
                            incidentId: incidentId,
                            eventType: 'identified',
                        })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            alertId = res.body._id;
                            expect(res).to.have.status(200);
                            expect(res.body).to.be.an('object');
                            done();
                        });
                });
        });

        it('should get an array of alerts by valid projectId', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .get(`/alert/${projectId}/alert`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    done();
                });
        });

        it('should get an array alerts of by valid incidentId', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .get(`/alert/${projectId}/incident/${incidentId}`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    done();
                });
        });

        it('should deleted alert', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .delete(`/alert/${projectId}`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    done();
                });
        });

        it('should not delete alert with non-existing projectId', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .delete('/alert/5f71e52737c855f7c5b347d3')
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    let newUserToken: $TSFixMe;

    describe('Alert API with Sub-Projects', function (): void {
        this.timeout(40000);

        before(function (done: $TSFixMe): void {
            this.timeout(30000);
            const authorization: string = `Basic ${token}`;
            // Create a subproject for parent project
            GlobalConfig.initTestConfig().then((): void => {
                request
                    .post(`/project/${projectId}/subProject`)
                    .set('Authorization', authorization)
                    .send({ subProjectName: 'New SubProject' })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        subProjectId = res.body[0]._id;
                        // Sign up second user (subproject user)
                        createUser(
                            request,
                            userData.newUser,
                            (err: $TSFixMe, res: $TSFixMe): void => {
                                userId = res.body.id;
                                UserModel.findByIdAndUpdate(
                                    userId,
                                    { $set: { isVerified: true } },
                                    (): void => {
                                        request
                                            .post('/user/login')
                                            .send({
                                                email: userData.newUser.email,
                                                password:
                                                    userData.newUser.password,
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
                                                    // Add second user to subproject
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
                                                        .end((): void => {
                                                            done();
                                                        });
                                                }
                                            );
                                    }
                                );
                            }
                        );
                    });
            });
        });

        after(async (): void => {
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
            await MonitorService.hardDeleteBy({ _id: monitorId });
            await IncidentService.hardDeleteBy({ _id: incidentId });
            await AlertService.hardDeleteBy({ _id: alertId });
            GlobalConfig.removeTestConfig();
        });

        it('should not create alert for user not in the project.', (done: $TSFixMe): void => {
            createUser(
                request,
                userData.anotherUser,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    userId = res.body.id;
                    UserModel.findByIdAndUpdate(
                        userId,
                        { $set: { isVerified: true } },
                        (): void => {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.anotherUser.email,
                                    password: userData.anotherUser.password,
                                })
                                .end((err: $TSFixMe, res: $TSFixMe): void => {
                                    const authorization: string = `Basic ${res.body.tokens.jwtAccessToken}`;
                                    request
                                        .post(`/alert/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send({
                                            monitorId: monitorId,
                                            alertVia: 'email',
                                            incidentId: incidentId,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            alertId = res.body._id;
                                            expect(res).to.have.status(400);
                                            expect(
                                                res.body.message
                                            ).to.be.equal(
                                                'You are not present in this project.'
                                            );
                                            done();
                                        });
                                });
                        }
                    );
                }
            );
        });

        it('should create alert in parent project', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .post(`/alert/${projectId}`)
                .set('Authorization', authorization)
                .send({
                    monitorId: monitorId,
                    alertVia: 'email',
                    incidentId: incidentId,
                    eventType: 'identified',
                })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    alertId = res.body._id;
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    done();
                });
        });

        it('should create alert in sub-project', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${newUserToken}`;
            request
                .post(`/alert/${subProjectId}`)
                .set('Authorization', authorization)
                .send({
                    monitorId: monitorId,
                    alertVia: 'email',
                    incidentId: incidentId,
                    eventType: 'identified',
                })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    done();
                });
        });

        it('should get only sub-project alerts for valid user.', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${newUserToken}`;
            request
                .get(`/alert/${subProjectId}/alert`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    done();
                });
        });

        it('should get both project and sub-project alerts for valid user.', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .get(`/alert/${projectId}`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('array');
                    expect(res.body[0]).to.have.property('alerts');
                    expect(res.body[0]).to.have.property('count');
                    expect(res.body[0]._id).to.be.equal(subProjectId);
                    expect(res.body[1]._id).to.be.equal(projectId);
                    done();
                });
        });

        it('should delete sub-project alert', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .delete(`/alert/${subProjectId}`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    done();
                });
        });

        it('should delete project alert', (done: $TSFixMe): void => {
            const authorization: string = `Basic ${token}`;
            request
                .delete(`/alert/${projectId}`)
                .set('Authorization', authorization)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    expect(res).to.have.status(200);
                    done();
                });
        });
    });
});
