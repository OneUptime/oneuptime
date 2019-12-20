/* eslint-disable linebreak-style */
process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
var app = require('../server');

var request = chai.request.agent(app);
var { createUser } = require('./utils/userSignUp');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var AirtableService = require('../backend/services/airtableService');

var VerificationTokenModel = require('../backend/models/verificationToken');

var projectId, userId, airtableId, token;

describe('Tutorial API', function () {
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
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await AirtableService.deleteUser(airtableId);
    });

    it('should get the user tutorial status', function (done) {
        var authorization = `Basic ${token}`;
        request.get('/tutorial').set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body._id).to.be.equal(userId);
            done();
        });
    });

    it('should update the user tutorial status', function (done) {
        var authorization = `Basic ${token}`;
        request.put('/tutorial').set('Authorization', authorization).send({
            type: 'monitor'
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('data');
            expect(res.body._id).to.be.equal(userId);
            done();
        });
    });
});