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
let FeedbackService = require('../backend/services/feedbackService');
let ProjectService = require('../backend/services/projectService');
let VerificationTokenModel = require('../backend/models/verificationToken');
let AirtableService = require('../backend/services/airtableService');
let token, projectId, userId, airtableId;

describe('Feedback API', function () {
    this.timeout(50000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        done();
                    });
                });
            });
        });
    });

    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId }, userId);
        await AirtableService.deleteUser(airtableId);
    });

    it('should create feedback and check the sent emails to fyipe team and user', function (done) {

        let authorization = `Basic ${token}`;
        let testFeedback = {
            feedback: 'test feedback',
            page: 'test page'
        };
        request.post(`/feedback/${projectId}`).set('Authorization', authorization).send(testFeedback).end(async function (err, res) {
            expect(res).to.have.status(200);
            FeedbackService.hardDeleteBy({ _id: res.body._id });
            AirtableService.deleteFeedback(res.body.airtableId);
            let emailStatuses = await EmailStatusService.findBy({});
            expect(emailStatuses[0].subject).to.equal('Thank you for your feedback!');
            done();
        });
    });
});