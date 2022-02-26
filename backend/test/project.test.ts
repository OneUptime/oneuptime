// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
// @ts-expect-error ts-migrate(2322) FIXME: Type 'true' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.IS_SAAS_SERVICE = true;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'getPlans'.
import plans from '../backend/config/plans').getPlans(
import log from './data/log'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import AirtableService from '../backend/services/airtableService'
import GlobalConfig from './utils/globalConfig'
import VerificationTokenModel from '../backend/models/verificationToken'

// let token, userId, projectId;
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'token' implicitly has type 'any' in some... Remove this comment to see the full error message
let token, projectId, subProjectId, userId;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Project API', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(30000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done) {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    err,
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
                    verificationToken
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
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    done();
                                });
                        });
                });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject the request of an unauthenticated user', function(done) {
        request
            .post('/project/create')
            .send({
                projectName: 'Test Project Name',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[0].planId,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a project when `projectName` is not given', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: null,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[0].planId,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a project when `planId` is not given', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Unnamed Project',
                planId: null,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a new project when `planId` and `projectName` is given', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Test Project',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[0].planId,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                ProjectService.hardDeleteBy({ _id: res.body._id });
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get projects for a valid user', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .get('/project/projects')
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reset the API key for a project given the `projectId`', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Token Project',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[0].planId,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                request
                    .get(`/project/${res.body._id}/resetToken`)
                    .set('Authorization', authorization)
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    .end(function(err, response) {
                        expect(response).to.have.status(200);
                        expect(res.body.apiKey).to.not.be.equal(
                            response.body.apiKey
                        );
                        ProjectService.hardDeleteBy({ _id: response.body._id });
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not rename a project when the `projectName` is null or invalid', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/renameProject`)
            .set('Authorization', authorization)
            .send({
                projectName: null,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should rename a project when `projectName` is given', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Old Project',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[0].planId,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                request
                    .put(`/project/${res.body._id}/renameProject`)
                    .set('Authorization', authorization)
                    .send({
                        projectName: 'Renamed Project',
                    })
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body.name).to.not.equal('Old Project');
                        ProjectService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return error when project balance is tried to accessed without supplying a projectId', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .get(`/project/${null}/balance`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch a project balance when projectId is given', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/project/${projectId}/balance`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.balance).to.be.eql(0);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a project when `projectId` is given', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'To-Delete Project',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[0].planId,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                request
                    .delete(`/project/${res.body._id}/deleteProject`)
                    .set('Authorization', authorization)
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        ProjectService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not upgrade the subscription plan of the user for a project to enterprise plan if not an admin', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/admin/changePlan`)
            .set('Authorization', authorization)
            .send({
                projectName: 'Unnamed Project',
                planId: 'enterprise',
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, response) {
                expect(response).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should upgrade the subscription plan of the user for a project to enterprise plan by an admin', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'userId' implicitly has an 'any' type.
        UserService.updateBy({ _id: userId }, { role: 'master-admin' }).then(
            () => {
                request
                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
                    .put(`/project/${projectId}/admin/changePlan`)
                    .set('Authorization', authorization)
                    .send({
                        projectName: 'Unnamed Project',
                        planId: 'enterprise',
                    })
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    .end(function(err, response) {
                        expect(response).to.have.status(200);
                        expect(response.body.stripePlanId).to.be.equal(
                            'enterprise'
                        );
                        done();
                    });
            }
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should change the subscription plan of the user for a project to any other plan by an admin', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/admin/changePlan`)
            .set('Authorization', authorization)
            .send({
                projectName: 'Unnamed Project',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[1].planId,
                oldPlan: 'Enterprise',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                newPlan: `${plans[1].category} ${plans[1].details}`,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, response) {
                expect(response).to.have.status(200);
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                expect(response.body.stripePlanId).to.be.equal(plans[1].planId);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should change the subscription plan of the user for a project', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/project/${projectId}/changePlan`)
            .set('Authorization', authorization)
            .send({
                projectName: 'New Project Name',
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                planId: plans[1].planId,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                oldPlan: `${plans[0].category} ${plans[0].details}`,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                newPlan: `${plans[1].category} ${plans[1].details}`,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, response) {
                expect(response).to.have.status(200);
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                expect(response.body.stripePlanId).to.be.equal(plans[1].planId);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should remove a user from a project', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/project/${projectId}/user/${userId}/exitProject`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                log(res.text);
                expect(res).to.have.status(200);
                expect(res.text).to.be.equal(
                    'User successfully exited the project'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should disable sending incident created email notification to external subscribers', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/advancedOptions/email`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationEmail: false,
                sendAcknowledgedIncidentNotificationEmail: true,
                sendResolvedIncidentNotificationEmail: true,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(
                    res.body.sendCreatedIncidentNotificationEmail
                ).to.be.false;
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should disable sending incident acknowledged email notification to external subscribers', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/advancedOptions/email`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationEmail: true,
                sendAcknowledgedIncidentNotificationEmail: false,
                sendResolvedIncidentNotificationEmail: true,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(
                    res.body.sendAcknowledgedIncidentNotificationEmail
                ).to.be.false;
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should disable sending incident resolved email notification to external subscribers', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/advancedOptions/email`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationEmail: true,
                sendAcknowledgedIncidentNotificationEmail: true,
                sendResolvedIncidentNotificationEmail: false,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(
                    res.body.sendResolvedIncidentNotificationEmail
                ).to.be.false;
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should disable sending incident created sms notification to external subscribers', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/advancedOptions/sms`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationSms: false,
                sendAcknowledgedIncidentNotificationSms: true,
                sendResolvedIncidentNotificationSms: true,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.sendCreatedIncidentNotificationSms).to.be.false;
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should disable sending incident acknowledged sms notification to external subscribers', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/advancedOptions/sms`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationSms: true,
                sendAcknowledgedIncidentNotificationSms: false,
                sendResolvedIncidentNotificationSms: true,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(
                    res.body.sendAcknowledgedIncidentNotificationSms
                ).to.be.false;
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should disable sending incident resolved sms notification to external subscribers', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/advancedOptions/sms`)
            .set('Authorization', authorization)
            .send({
                sendCreatedIncidentNotificationSms: true,
                sendAcknowledgedIncidentNotificationSms: true,
                sendResolvedIncidentNotificationSms: false,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(
                    res.body.sendResolvedIncidentNotificationSms
                ).to.be.false;
                done();
            });
    });
});

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Projects SubProjects API', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(30000);
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done) {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
        createUser(request, userData.user, function(err, res) {
            const project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function(
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                err,
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
                verificationToken
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
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                            .end(function(err, res) {
                                token = res.body.tokens.jwtAccessToken;
                                done();
                            });
                    });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await ProjectService.hardDeleteBy({
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a subproject without a name.', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: '' })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Subproject name must be present.'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a subproject.', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                subProjectId = res.body[0]._id;
                expect(res).to.have.status(200);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not get subprojects for a user not present in the project.', function(done) {
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
        createUser(request, userData.newUser, function(err, res) {
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function(
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                err,
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
                verificationToken
            ) {
                request
                    .get(`/user/confirmation/${verificationToken.token}`)
                    .redirects(0)
                    .end(function() {
                        request
                            .post('/user/login')
                            .send({
                                email: userData.newUser.email,
                                password: userData.newUser.password,
                            })
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                            .end(function(err, res) {
                                const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                                request
                                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
                                    .get(`/project/${projectId}/subProjects`)
                                    .set('Authorization', authorization)
                                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                    .end(function(err, res) {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get subprojects for a valid user.', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/project/${projectId}/subProjects`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.data).to.be.an('array');
                // @ts-expect-error ts-migrate(7005) FIXME: Variable 'subProjectId' implicitly has an 'any' ty... Remove this comment to see the full error message
                expect(res.body.data[0]._id).to.be.equal(subProjectId);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not rename a subproject when the subproject is null or invalid or empty', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                subProjectName: null,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should rename a subproject with valid name', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/project/${projectId}/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                subProjectName: 'Renamed SubProject',
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal('Renamed SubProject');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a subproject', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/project/${projectId}/${subProjectId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
