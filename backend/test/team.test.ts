// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
// @ts-expect-error ts-migrate(2322) FIXME: Type 'true' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.IS_SAAS_SERVICE = true;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import NotificationService from '../backend/services/notificationService'
import AirtableService from '../backend/services/airtableService'

import payment from '../backend/config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey

import VerificationTokenModel from '../backend/models/verificationToken'
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'token' implicitly has type 'any' in some... Remove this comment to see the full error message
// eslint-disable-next-line
let token, userId, projectId, anotherUser;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Team API', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        await GlobalConfig.initTestConfig();
        const res = await createUser(request, userData.user);
        const project = res.body.project;
        projectId = project._id;
        userId = res.body.id;

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = res.body.tokens.jwtAccessToken;
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /monitor/:projectId/monitor'
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject the request of an unauthenticated user', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
        const res = await request.get(`/team/${projectId}`).send({
            name: 'New Schedule',
        });
        expect(res).to.have.status(401);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get an array of users', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/team/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add new users when the `emails` field is invalid', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: null,
                role: 'Member',
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add new users when the `role` field is invalid', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: 'noreply@oneuptime.com',
                role: null,
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add new users when the `role` and `emails` field are valid', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: 'noreply1@oneuptime.com',
                role: 'Member',
            });
        anotherUser = res.body[0].team[0].userId;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not change user roles when the `role` field is invalid', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/team/${projectId}/${anotherUser}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: null,
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not change user roles when the `teamMemberId` field is invalid', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/team/${projectId}/team/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Administrator',
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should change user roles', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/team/${projectId}/${anotherUser}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Administrator',
            });
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'anotherUser' implicitly has an 'any' typ... Remove this comment to see the full error message
        expect(res.body[0].team[0].userId).to.be.equal(anotherUser);
        expect(res.body[0].team[0].role).to.be.equal('Administrator');
        expect(res).to.have.status(200);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not delete users when the `teamId` is not valid', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/team/${projectId}/xxx`)
            .set('Authorization', authorization);
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete users', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/team/${projectId}/${anotherUser}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get unregistered user email from the token', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: 'noreply4@oneuptime.com',
                role: 'Member',
            });
        const { userId } = res.body[0].team[0];
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');

        const res1 = await request.get(
            `/user/${verificationToken.token}/email`
        );
        expect(res1).to.have.status(200);
        expect(res1.body.token.userId.email).to.equal('noreply4@oneuptime.com');
    });
});

// @ts-expect-error ts-migrate(7034) FIXME: Variable 'subProjectId' implicitly has type 'any' ... Remove this comment to see the full error message
// eslint-disable-next-line no-unused-vars
let subProjectId,
    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'newUserToken' implicitly has type 'any' ... Remove this comment to see the full error message
    newUserToken,
    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'subProjectTeamMemberId' implicitly has t... Remove this comment to see the full error message
    subProjectTeamMemberId,
    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'projectTeamMemberId' implicitly has type... Remove this comment to see the full error message
    projectTeamMemberId,
    subProjectUserId;
userData.newUser.email = 'newUser@company.com'; // overide test emails to test project seats.
userData.anotherUser.email = 'anotherUser@company.com'; // overide test emails to test project seats.

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Team API with Sub-Projects', async function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(60000);
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        // create a subproject for parent project
        const res1 = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' });
        subProjectId = res1.body[0]._id;
        // sign up second user (subproject user)
        const checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{ randomU... Remove this comment to see the full error message
            email: userData.email,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type '{ r... Remove this comment to see the full error message
            companyName: userData.companyName,
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntents' does not exist on type '... Remove this comment to see the full error message
        const confirmedPaymentIntent = await stripe.paymentIntents.confirm(
            checkCardData.body.id
        );

        const res2 = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id,
            },
            ...userData.newUser,
        });

        subProjectUserId = res2.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId: subProjectUserId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const res3 = await request.post('/user/login').send({
            email: userData.newUser.email,
            password: userData.newUser.password,
        });
        newUserToken = res3.body.tokens.jwtAccessToken;
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
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
                    'noreply1@oneuptime.com',
                    'testmail@oneuptime.com',
                ],
            },
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add a new user to sub-project (role -> `Member`, project seat -> 4)', async () => {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'subProjectId' implicitly has an 'any' ty... Remove this comment to see the full error message
            .post(`/team/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.newUser.email,
                role: 'Member',
            });
        const subProjectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        subProjectTeamMemberId = subProjectTeamMembers[0].userId;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const project = await ProjectService.findOneBy({
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            query: { _id: projectId },
            select: 'seats',
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(subProjectTeamMembers[0].email).to.equal(userData.newUser.email);
        expect(parseInt(project.seats)).to.be.equal(4);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add a new user to parent project and all sub-projects (role -> `Administrator`, project seat -> 4)', async () => {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.anotherUser.email,
                role: 'Administrator',
            });
        const subProjectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        const projectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === projectId
        ).team;
        projectTeamMemberId = projectTeamMembers[0].userId;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const project = await ProjectService.findOneBy({
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            query: { _id: projectId },
            select: 'seats',
        });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(projectTeamMembers[0].email).to.equal(
            userData.anotherUser.email
        );
        expect(subProjectTeamMembers[0].email).to.equal(
            userData.anotherUser.email
        );
        expect(parseInt(project.seats)).to.be.equal(5);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update existing user role in sub-project (old role -> member, new role -> administrator)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'subProjectId' implicitly has an 'any' ty... Remove this comment to see the full error message
            .put(`/team/${subProjectId}/${subProjectTeamMemberId}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Administrator',
            });

        const subProjectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(subProjectTeamMembers[1].role).to.equal('Administrator');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .put(`/team/${projectId}/${projectTeamMemberId}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Member',
            });
        const projectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === projectId
        ).team;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(projectTeamMembers[0].role).to.equal('Member');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should get only sub-project's team members for valid sub-project user", async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'newUserToken' implicitly has an 'any' ty... Remove this comment to see the full error message
        const authorization = `Basic ${newUserToken}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'subProjectId' implicitly has an 'any' ty... Remove this comment to see the full error message
            .get(`/team/${subProjectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body.length).to.be.equal(4);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get both project and sub-project Team Members.', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/team/${projectId}/teamMembers`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body[0]).to.have.property('count');
        expect(res.body.length).to.be.equal(2);
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'subProjectId' implicitly has an 'any' ty... Remove this comment to see the full error message
        expect(res.body[0]._id).to.be.equal(subProjectId);
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
        expect(res.body[1]._id).to.be.equal(projectId);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should remove user from sub-project Team Members (project team members count -> 2, project seat -> 3)', async () => {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'subProjectId' implicitly has an 'any' ty... Remove this comment to see the full error message
            .delete(`/team/${subProjectId}/${subProjectTeamMemberId}`)
            .set('Authorization', authorization);
        const subProjectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const project = await ProjectService.findOneBy({
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            query: { _id: projectId },
            select: 'seats',
        });
        expect(res).to.have.status(200);
        expect(subProjectTeamMembers.length).to.be.equal(3);
        expect(parseInt(project.seats)).to.be.equal(4);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should remove user from project Team Members and all sub-projects (sub-project team members count -> 1, project seat -> 2)', async () => {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/team/${projectId}/${projectTeamMemberId}`)
            .set('Authorization', authorization);
        const projectTeamMembers = res.body.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'teamMembers' implicitly has an 'any' ty... Remove this comment to see the full error message
            teamMembers => teamMembers.projectId === projectId
        ).team;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const project = await ProjectService.findOneBy({
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            query: { _id: projectId },
            select: 'seats',
        });
        expect(res).to.have.status(200);
        expect(projectTeamMembers.length).to.be.equal(2);
        expect(parseInt(project.seats)).to.be.equal(3);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add members that are more than 100 on a project (role -> `Member`)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.bulkUsers.emails,
                role: 'Member',
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add members on a project if sum of new and old members exceeds 100 (role -> `Member`)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.otherBulkUsers.emails,
                role: 'Member',
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add members without business emails (role -> `Member`)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const emails = 'sample.yahoo.com,sample@gmail.com';
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: emails,
                role: 'Member',
            });
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add members on a project if the number does not exceeds 100 (role -> `Member`)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.moreBulkUsers.emails,
                role: 'Member',
            });
        expect(res).to.have.status(200);
        expect(res.body[0].team.length).to.be.equal(100);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add unlimited members for the Viewer role (role -> `Viewer`)', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.bulkUsers.emails,
                role: 'Viewer',
            });
        expect(res).to.have.status(200);
        expect(res.body[0].team.length).to.be.equal(220);
    });
});
