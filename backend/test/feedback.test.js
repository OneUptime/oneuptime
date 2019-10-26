process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');
var mailParser = require('mailparser').simpleParser;


var request = chai.request.agent(app);
var UserService = require('../backend/services/userService');
var FeedbackService = require('../backend/services/feedbackService');
var ProjectService = require('../backend/services/projectService');
var AirtableService = require('../backend/services/airtableService');
var VerificationTokenModel = require('../backend/models/verificationToken');
var token, projectId, userId, emailContent;
var { imap, openBox, feedbackEmailContent } = require('./utils/mail');


describe('Feedback API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function () {
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
    });

    it('should create feedback and check the sent emails to fyipe team and user', function (done) {

        var authorization = `Basic ${token}`;
        var testFeedback = {
            feedback: 'test feedback',
            page: 'test page'
        };
        request.post(`/feedback/${projectId}`).set('Authorization', authorization).send(testFeedback).end(function (err, res) {
            expect(res).to.have.status(200);
            FeedbackService.hardDeleteBy({ _id: res.body._id });
            AirtableService.deleteFeedback(res.body.airtableId);
            imap.once('ready', function () {
                openBox(function (err) {
                    if (err) throw err;
                    var f = imap.seq.fetch('1:3', {
                        bodies: [''],
                        struct: true
                    });
                    f.on('message', function (msg) {
                        msg.on('body', function (stream) {
                            mailParser(stream, {}, async function (err, parsedMail) {
                                if (parsedMail.subject === 'New Lead Added') {
                                    emailContent = await JSON.parse(parsedMail.text);
                                    expect(emailContent).to.be.an('object');
                                    expect(emailContent.message).to.be.equal(testFeedback.feedback);
                                    expect(emailContent.page).to.be.equal(testFeedback.page);
                                }
                                if (parsedMail.subject === 'Thank you for your feedback!') {
                                    emailContent = (parsedMail.text);
                                    expect(emailContent).to.be.equal(feedbackEmailContent);
                                }
                            });
                        });
                    });
                    f.once('end', function () {
                        done();
                        imap.end();
                    });
                });
            });
            imap.connect();
        });
    });
});