process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');

const payment = require('../backend/config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);

const VerificationTokenModel = require('../backend/models/verificationToken');
// eslint-disable-next-line
let token, userId, airtableId, projectId, anotherUser;

describe('Team API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            const project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function(
                err,
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
                            .end(function(err, res) {
                                token = res.body.tokens.jwtAccessToken;
                                done();
                            });
                    });
            });
        });
    });

    after(async function() {
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    // 'post /monitor/:projectId/monitor'
    it('should reject the request of an unauthenticated user', function(done) {
        request
            .get(`/team/${projectId}`)
            .send({
                name: 'New Schedule',
            })
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should get an array of users', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/team/${projectId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should not add new users when the `emails` field is invalid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: null,
                role: 'Member',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not add new users when the `role` field is invalid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: 'noreply@fyipe.com',
                role: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should add new users when the `role` and `emails` field are valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: 'noreply1@fyipe.com',
                role: 'Member',
            })
            .end(function(err, res) {
                anotherUser = res.body[0].team[0].userId;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should not change user roles when the `role` field is invalid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/team/${projectId}/${anotherUser}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: null,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not change user roles when the `teamMemberId` field is invalid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/team/${projectId}/team/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Administrator',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should change user roles', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/team/${projectId}/${anotherUser}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Administrator',
            })
            .end(function(err, res) {
                expect(res.body[0].team[0].userId).to.be.equal(anotherUser);
                expect(res.body[0].team[0].role).to.be.equal('Administrator');
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should not delete users when the `teamId` is not valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/team/${projectId}/xxx`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should delete users', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/team/${projectId}/${anotherUser}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId,
    newUserToken,
    subProjectTeamMemberId,
    projectTeamMemberId,
    subProjectUserId;
userData.newUser.email = 'newUser@company.com'; // overide test emails to test project seats.
userData.anotherUser.email = 'anotherUser@company.com'; // overide test emails to test project seats.

describe('Team API with Sub-Projects', async function() {
    this.timeout(20000);
    before(async function() {
        this.timeout(30000);
        const authorization = `Basic ${token}`;
        // create a subproject for parent project
        const res1 = await request
            .post(`/project/${projectId}/subProject`)
            .set('Authorization', authorization)
            .send({ subProjectName: 'New SubProject' });
        subProjectId = res1.body[0]._id;
        // sign up second user (subproject user)
        const checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: userData.email,
            companyName: userData.companyName,
        });
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
        request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0)
            .end(async function() {
                const res3 = await request.post('/user/login').send({
                    email: userData.newUser.email,
                    password: userData.newUser.password,
                });
                newUserToken = res3.body.tokens.jwtAccessToken;
            });
    });

    after(async function() {
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, subProjectId] },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                    'noreply1@fyipe.com',
                    'testmail@fyipe.com',
                ],
            },
        });
    });

    it('should add a new user to sub-project (role -> `Member`, project seat -> 3)', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/team/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.newUser.email,
                role: 'Member',
            });
        const subProjectTeamMembers = res.body.find(
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        subProjectTeamMemberId = subProjectTeamMembers[0].userId;
        const project = await ProjectService.findOneBy({ _id: projectId });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(subProjectTeamMembers[0].email).to.equal(userData.newUser.email);
        expect(parseInt(project.seats)).to.be.equal(3);
    });

    it('should add a new user to parent project and all sub-projects (role -> `Administrator`, project seat -> 4)', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.anotherUser.email,
                role: 'Administrator',
            });
        const subProjectTeamMembers = res.body.find(
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        const projectTeamMembers = res.body.find(
            teamMembers => teamMembers.projectId === projectId
        ).team;
        projectTeamMemberId = projectTeamMembers[0].userId;
        const project = await ProjectService.findOneBy({ _id: projectId });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(projectTeamMembers[0].email).to.equal(
            userData.anotherUser.email
        );
        expect(subProjectTeamMembers[0].email).to.equal(
            userData.anotherUser.email
        );
        expect(parseInt(project.seats)).to.be.equal(4);
    });

    it('should update existing user role in sub-project (old role -> member, new role -> administrator)', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/team/${subProjectId}/${subProjectTeamMemberId}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Administrator',
            })
            .end(function(err, res) {
                const subProjectTeamMembers = res.body.find(
                    teamMembers => teamMembers.projectId === subProjectId
                ).team;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(subProjectTeamMembers[1].role).to.equal('Administrator');
                done();
            });
    });

    it('should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/team/${projectId}/${projectTeamMemberId}/changerole`)
            .set('Authorization', authorization)
            .send({
                role: 'Member',
            })
            .end(function(err, res) {
                const projectTeamMembers = res.body.find(
                    teamMembers => teamMembers.projectId === projectId
                ).team;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(projectTeamMembers[0].role).to.equal('Member');
                done();
            });
    });

    it("should get only sub-project's team members for valid sub-project user", function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/team/${subProjectId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body.length).to.be.equal(3);
                done();
            });
    });

    it('should get both project and sub-project Team Members.', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/team/${projectId}/teamMembers`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('count');
                expect(res.body.length).to.be.equal(2);
                expect(res.body[0]._id).to.be.equal(subProjectId);
                expect(res.body[1]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should remove user from sub-project Team Members (project team members count -> 2, project seat -> 3)', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .delete(`/team/${subProjectId}/${subProjectTeamMemberId}`)
            .set('Authorization', authorization);
        const subProjectTeamMembers = res.body.find(
            teamMembers => teamMembers.projectId === subProjectId
        ).team;
        const project = await ProjectService.findOneBy({ _id: projectId });
        expect(res).to.have.status(200);
        expect(subProjectTeamMembers.length).to.be.equal(2);
        expect(parseInt(project.seats)).to.be.equal(3);
    });

    it('should remove user from project Team Members and all sub-projects (sub-project team members count -> 1, project seat -> 2)', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .delete(`/team/${projectId}/${projectTeamMemberId}`)
            .set('Authorization', authorization);
        const projectTeamMembers = res.body.find(
            teamMembers => teamMembers.projectId === projectId
        ).team;
        const project = await ProjectService.findOneBy({ _id: projectId });
        expect(res).to.have.status(200);
        expect(projectTeamMembers.length).to.be.equal(1);
        expect(parseInt(project.seats)).to.be.equal(2);
    });
});
