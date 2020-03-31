/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const EmailStatusService = require('../backend/services/emailStatusService');
const request = chai.request.agent(app);
const GlobalConfig = require('./utils/globalConfig');
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const VerificationTokenModel = require('../backend/models/verificationToken');
const AirtableService = require('../backend/services/airtableService');

let userId, airtableId, projectId;

describe('Email verification API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                userId = res.body.id;
                projectId = res.body.project._id;
                airtableId = res.body.airtableId;

                done();
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await ProjectService.hardDeleteBy({ _id: projectId }, userId);
        await AirtableService.deleteUser(airtableId);
    });

    it('should send email verification', async function() {
        const emailStatuses = await EmailStatusService.findBy({});
        expect(emailStatuses[0].subject).to.equal('Welcome to Fyipe.');
        expect(emailStatuses[0].status).to.equal('Email not enabled.');
    });

    it('should not login non-verified user', async function() {
        try {
            await request.post('/user/login').send({
                email: userData.user.email,
                password: userData.user.password,
            });
        } catch (error) {
            expect(error).to.have.status(401);
        }
    });

    it('should verify the user', async function() {
        const token = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${token.token}`).redirects(0);
        } catch (error) {
            expect(error).to.have.status(302);
            const user = await UserService.findOneBy({ _id: userId });
            expect(user.isVerified).to.be.equal(true);
        }
    });

    it('should login the verified user', async function() {
        const res = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        expect(res).to.have.status(200);
    });
});
