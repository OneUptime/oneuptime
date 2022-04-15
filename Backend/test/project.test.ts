process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';

import Plans from '../backend/config/plans';
const plans: $TSFixMe = Plans.getPlans();
import log from './data/log';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import VerificationTokenModel from '../backend/models/verificationToken';

// let token: $TSFixMe, userId: $TSFixMe, projectId: $TSFixMe;

let token: $TSFixMe,
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    userId: $TSFixMe;

describe('Project API', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        (
                            err,

                            verificationToken
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
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })

                                        .end(
                                            (
                                                err: $TSFixMe,
                                                res: $TSFixMe
                                            ): void => {
                                                token =
                                                    res.body.tokens
                                                        .jwtAccessToken;
                                                done();
                                            }
                                        );
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
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /user/signup'

    it('should reject the request of an unauthenticated user', (done: $TSFixMe): void => {
        request
            .post('/project/create')
            .send({
                projectName: 'Test Project Name',

                planId: plans[0].planId,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not create a project when `projectName` is not given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: null,

                planId: plans[0].planId,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a project when `planId` is not given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Unnamed Project',
                planId: null,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create a new project when `planId` and `projectName` is given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Test Project',

                planId: plans[0].planId,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                ProjectService.hardDeleteBy({ _id: res.body._id });
                done();
            });
    });

    it('should get projects for a valid user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get('/project/projects')
            .set('Authorization', authorization)

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should reset the API key for a project given the `projectId`', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Token Project',

                planId: plans[0].planId,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                request
                    .get(`/project/${res.body._id}/resetToken`)
                    .set('Authorization', authorization)

                    .end((err, response): void => {
                        expect(response).to.have.status(200);
                        expect(res.body.apiKey).to.not.be.equal(
                            response.body.apiKey
                        );
                        ProjectService.hardDeleteBy({ _id: response.body._id });
                        done();
                    });
            });
    });

    it('should not rename a project when the `projectName` is null or invalid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/renameProject`)
            .set('Authorization', authorization)
            .send({
                projectName: null,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should rename a project when `projectName` is given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Old Project',

                planId: plans[0].planId,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                request
                    .put(`/project/${res.body._id}/renameProject`)
                    .set('Authorization', authorization)
                    .send({
                        projectName: 'Renamed Project',
                    })

                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        expect(res.body.name).to.not.equal('Old Project');
                        ProjectService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
    });

    it('should return error when project balance is tried to accessed without supplying a projectId', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/project/${null}/balance`)
            .set('Authorization', authorization)

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fetch a project balance when projectId is given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .get(`/project/${projectId}/balance`)
            .set('Authorization', authorization)

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.balance).to.be.eql(0);
                done();
            });
    });

    it('should delete a project when `projectId` is given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'To-Delete Project',

                planId: plans[0].planId,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                request
                    .delete(`/project/${res.body._id}/deleteProject`)
                    .set('Authorization', authorization)

                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        ProjectService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
    });

    it('should not upgrade the subscription plan of the user for a project to enterprise plan if not an admin', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/admin/changePlan`)
            .set('Authorization', authorization)
            .send({
                projectName: 'Unnamed Project',
                planId: 'enterprise',
            })

            .end((err, response): void => {
                expect(response).to.have.status(400);
                done();
            });
    });

    it('should upgrade the subscription plan of the user for a project to enterprise plan by an admin', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

        UserService.updateBy({ _id: userId }, { role: 'master-admin' }).then(
            () => {
                request

                    .put(`/project/${projectId}/admin/changePlan`)
                    .set('Authorization', authorization)
                    .send({
                        projectName: 'Unnamed Project',
                        planId: 'enterprise',
                    })

                    .end((err, response): void => {
                        expect(response).to.have.status(200);
                        expect(response.body.stripePlanId).to.be.equal(
                            'enterprise'
                        );
                        done();
                    });
            }
        );
    });

    it('should change the subscription plan of the user for a project to any other plan by an admin', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/admin/changePlan`)
            .set('Authorization', authorization)
            .send({
                projectName: 'Unnamed Project',

                planId: plans[1].planId,
                oldPlan: 'Enterprise',

                newPlan: `${plans[1].category} ${plans[1].details}`,
            })

            .end((err, response): void => {
                expect(response).to.have.status(200);

                expect(response.body.stripePlanId).to.be.equal(plans[1].planId);
                done();
            });
    });

    it('should change the subscription plan of the user for a project', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .post(`/project/${projectId}/changePlan`)
            .set('Authorization', authorization)
            .send({
                projectName: 'New Project Name',

                planId: plans[1].planId,

                oldPlan: `${plans[0].category} ${plans[0].details}`,

                newPlan: `${plans[1].category} ${plans[1].details}`,
            })

            .end((err, response): void => {
                expect(response).to.have.status(200);

                expect(response.body.stripePlanId).to.be.equal(plans[1].planId);
                done();
            });
    });

    it('should remove a user from a project', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .delete(`/project/${projectId}/user/${userId}/exitProject`)
            .set('Authorization', authorization)

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                log(res.text);
                expect(res).to.have.status(200);
                expect(res.text).to.be.equal(
                    'User successfully exited the project'
                );
                done();
            });
    });

    it('should disable sending incident created email notification to external subscribers', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/advancedOptions/email`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationEmail: false,
                sendAcknowledgedIncidentNotificationEmail: true,
                sendResolvedIncidentNotificationEmail: true,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.sendCreatedIncidentNotificationEmail).to.be
                    .false;
                done();
            });
    });

    it('should disable sending incident acknowledged email notification to external subscribers', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/advancedOptions/email`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationEmail: true,
                sendAcknowledgedIncidentNotificationEmail: false,
                sendResolvedIncidentNotificationEmail: true,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.sendAcknowledgedIncidentNotificationEmail).to.be
                    .false;
                done();
            });
    });

    it('should disable sending incident resolved email notification to external subscribers', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/advancedOptions/email`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationEmail: true,
                sendAcknowledgedIncidentNotificationEmail: true,
                sendResolvedIncidentNotificationEmail: false,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.sendResolvedIncidentNotificationEmail).to.be
                    .false;
                done();
            });
    });

    it('should disable sending incident created sms notification to external subscribers', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/advancedOptions/sms`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationSms: false,
                sendAcknowledgedIncidentNotificationSms: true,
                sendResolvedIncidentNotificationSms: true,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.sendCreatedIncidentNotificationSms).to.be.false;
                done();
            });
    });

    it('should disable sending incident acknowledged sms notification to external subscribers', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/advancedOptions/sms`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationSms: true,
                sendAcknowledgedIncidentNotificationSms: false,
                sendResolvedIncidentNotificationSms: true,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.sendAcknowledgedIncidentNotificationSms).to.be
                    .false;
                done();
            });
    });

    it('should disable sending incident resolved sms notification to external subscribers', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/advancedOptions/sms`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationSms: true,
                sendAcknowledgedIncidentNotificationSms: true,
                sendResolvedIncidentNotificationSms: false,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.sendResolvedIncidentNotificationSms).to.be
                    .false;
                done();
            });
    });
});

describe('Projects SubProjects API', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);

        createUser(
            request,
            userData.user,
            (err: $TSFixMe, res: $TSFixMe): void => {
                const project: $TSFixMe = res.body.project;
                projectId = project._id;
                userId = res.body.id;
                VerificationTokenModel.findOne(
                    { userId },
                    (
                        err,

                        verificationToken
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
                                        email: userData.user.email,
                                        password: userData.user.password,
                                    })

                                    .end(
                                        (
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ): void => {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            done();
                                        }
                                    );
                            });
                    }
                );
            }
        );
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
    });

    it('should not create a subproject without a name.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: '' })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Subproject name must be present.'
                );
                done();
            });
    });

    it('should create a subproject.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                subProjectId = res.body[0]._id;
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should not get subprojects for a user not present in the project.', (done: $TSFixMe): void => {
        createUser(
            request,
            userData.newUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                userId = res.body.id;
                VerificationTokenModel.findOne(
                    { userId },
                    (
                        err,

                        verificationToken
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
                                        email: userData.newUser.email,
                                        password: userData.newUser.password,
                                    })

                                    .end(
                                        (
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ): void => {
                                            const authorization: string = `Basic ${res.body.tokens.jwtAccessToken}`;
                                            request

                                                .get(
                                                    `/project/${projectId}/subProjects`
                                                )
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )

                                                .end(
                                                    (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ): void => {
                                                        expect(
                                                            res
                                                        ).to.have.status(400);
                                                        expect(
                                                            res.body.message
                                                        ).to.be.equal(
                                                            'You are not present in this project.'
                                                        );
                                                        done();
                                                    }
                                                );
                                        }
                                    );
                            });
                    }
                );
            }
        );
    });

    it('should get subprojects for a valid user.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .get(`/project/${projectId}/subProjects`)
            .set('Authorization', authorization)

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('array');

                expect(res.body.data[0]._id).to.be.equal(subProjectId);
                done();
            });
    });

    it('should not rename a subproject when the subproject is null or invalid or empty', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                subProjectName: null,
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should rename a subproject with valid name', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .put(`/project/${projectId}/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                subProjectName: 'Renamed SubProject',
            })

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('Renamed SubProject');
                done();
            });
    });

    it('should delete a subproject', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request

            .delete(`/project/${projectId}/${subProjectId}`)
            .set('Authorization', authorization)

            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });
});
