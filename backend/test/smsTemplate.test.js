/* eslint-disable no-useless-escape */
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
const SmsTemplateService = require('../backend/services/smsTemplateService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

let token, projectId, userId, airtableId, smsTemplateId;

describe('SMS Template API', function() {
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
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await SmsTemplateService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
    });

    // 'post /:projectId'
    it('should create an sms template with valid data', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/smsTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send({
                body: 'SMS Body',
                smsType: 'Subscriber Incident Created',
            })
            .end(function(err, res) {
                smsTemplateId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.body).to.be.equal('SMS Body');
                done();
            });
    });

    it('should sanitize dirty template data sent to endpoint', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/smsTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send({
                body: '<img src=x onerror=alert(1)//>',
                smsType: 'Subscriber Incident Created',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.body).to.be.equal('<img src="x">');
                done();
            });
    });

    it('should get an array of sms templates by valid projectId', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/smsTemplate/${projectId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    it('should get an sms template by valid smsTemplateId', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/smsTemplate/${projectId}/smsTemplate/${smsTemplateId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should update an sms template by valid smsTemplateId', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/smsTemplate/${projectId}/smsTemplate/${smsTemplateId}`)
            .send({
                body: 'New SMS Body',
            })
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body.body).to.be.equal('New SMS Body');

                done();
            });
    });

    it('should deleted an sms template', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/smsTemplate/${projectId}/smsTemplate/${smsTemplateId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
