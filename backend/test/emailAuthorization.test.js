process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');
let EmailStatusService = require('../backend/services/emailStatusService');
let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let VerificationTokenModel = require('../backend/models/verificationToken');
let AirtableService = require('../backend/services/airtableService');

let userId, airtableId, projectId;

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

    it('should send email verification', async function () {
        let emailStatuses = await EmailStatusService.findBy({});
        expect(emailStatuses[0].subject).to.equal('Welcome to Fyipe.');
        expect(emailStatuses[0].status).to.equal('Success');
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
        let token = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${token.token}`).redirects(0);
        } catch (error) {
            expect(error).to.have.status(302);
            let user = await UserService.findOneBy({ _id: userId });
            expect(user.isVerified).to.be.equal(true);
        }
    });

    it('should login the verified user', async function () {
        let res = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });
        expect(res).to.have.status(200);
    });
});