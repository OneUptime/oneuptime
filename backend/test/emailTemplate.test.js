/* eslint-disable no-useless-escape */
let expect = require('chai').expect;
process.env.PORT = 3020;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');

let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');
let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let EmailTemplateService = require('../backend/services/emailTemplateService');
let NotificationService = require('../backend/services/notificationService');
let VerificationTokenModel = require('../backend/models/verificationToken');
let AirtableService = require('../backend/services/airtableService');

let token, projectId, emailTemplateId, userId, airtableId;

describe('Email Template API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
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
        await ProjectService.hardDeleteBy({ _id: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await EmailTemplateService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    // 'post /:projectId'
    it('should create an email template with valid data', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/emailTemplate/${projectId}`).set('Authorization', authorization).send({
            subject: 'Mail Subject',
            body: 'Mail Body',
            emailType: 'Subscriber Incident Created'
        }).end(function (err, res) {
            emailTemplateId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body.subject).to.be.equal('Mail Subject');
            done();
        });
    });

    it('should sanitize dirty template data sent to endpoint', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/emailTemplate/${projectId}`).set('Authorization', authorization).send({
            subject: 'Mail Subject',
            body: '<img src=x onerror=alert(1)//>',
            emailType: 'Subscriber Incident Created'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.body).to.be.equal('<html><head></head><body><img src="x"></body></html>');
            done();
        });
    });

    it('should get an array of email templates by valid projectId', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/emailTemplate/${projectId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('array');
            done();
        });
    });

    it('should get an email template by valid emailTemplateId', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should update an email template by valid emailTemplateId', function (done) {
        let authorization = `Basic ${token}`;
        request.put(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`).send({
            subject: 'New Mail Subject'
        }).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body.subject).to.be.equal('New Mail Subject');
            done();
        });
    });

    it('should deleted an email template', function (done) {
        let authorization = `Basic ${token}`;
        request.delete(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.deleted).to.be.equal(true);
            done();
        });
    });
});