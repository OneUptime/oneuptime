process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');
var EmailStatusService = require('../backend/services/emailStatusService');
var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var VerificationTokenModel = require('../backend/models/verificationToken');
var AirtableService = require('../backend/services/airtableService');

var userId, airtableId, projectId;

describe('Email verification API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function (err, res) {
            userId = res.body.id;
            projectId = res.body.project._id;
            airtableId = res.body.airtableId;

            done();
        });
    });

    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId }, userId);
        await AirtableService.deleteUser(airtableId);
    });

    it('should send email verification', async function (done) {
        var emailStatuses = await EmailStatusService.findBy({});
        expect(emailStatuses[0].subject).to.equal('[Fyipe] Please confirm the email linked to your Fyipe ID');
        done();
    });

    it('should not login non-verified user', async function () {
        try {
            await request.post('/user/login').send({
                email: userData.user.email,
                password: userData.user.password
            });
        } catch (error) {
            expect(error).to.have.status(401);
        }
    });

    it('should verify the user', async function () {
        var token = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${token.token}`).redirects(0);
        } catch (error) {
            expect(error).to.have.status(302);
            var user = await UserService.findOneBy({ _id: userId });
            expect(user.isVerified).to.be.equal(true);
        }
    });

    it('should login the verified user', async function () {
        var res = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });
        expect(res).to.have.status(200);
    });
});