process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let projectData = require('./data/project');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');

let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let NotificationService = require('../backend/services/notificationService');
let AirtableService = require('../backend/services/airtableService');

let VerificationTokenModel = require('../backend/models/verificationToken');

let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');

let projectId, token, userId, airtableId;

describe('Notification API', function () {
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
        await AirtableService.deleteUser(airtableId);
    });

    it('should create a new notification', (done) => {
        let authorization = `Basic ${token}`;
        request.post(`/notification/${projectId}`).set('Authorization', authorization).send({
            message: 'New Notification',
            icon: 'bell'
        }).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should get project notifications current user is present in', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/notification/${projectId}`)
            .set('Authorization', authorization).send().end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should not get project notifications current user is not present in', function (done) {
        let authorization = `Basic ${token}`;
        request.get(`/notification/${projectData.firstProject._id}`)
            .set('Authorization', authorization).send().end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should mark project notification as read', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/notification/${projectId}`).set('Authorization', authorization).send({
            message: 'New Notification',
            icon: 'bell'
        }).end(function (err, res) {
            let notificationId = res.body._id;
            request.put(`/notification/${projectId}/${notificationId}/read`)
                .set('Authorization', authorization).end(function (err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body._id).to.be.equal(notificationId);
                    done();
                });
        });
    });

    it('should mark all project notifications as read', function (done) {
        let authorization = `Basic ${token}`;
        request.post(`/notification/${projectId}`).set('Authorization', authorization).send({
            message: 'New Notification',
            icon: 'bell'
        }).end(function () {
            request.put(`/notification/${projectId}/readAll`)
                .set('Authorization', authorization).end(function (err, res) {
                    expect(res).to.have.status(200);
                    done();
                });
        });
    });

    it('should reject request if the notification param is invalid ', function (done) {
        request.put(`/notification/${projectId}/${projectData.fakeProject._id}/read`).send().end(function (err, res) {
            expect(res).to.have.status(401);
            done();
        });
    });

});