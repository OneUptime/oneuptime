process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var VerificationTokenModel = require('../backend/models/verificationToken');


var request = chai.request.agent(app);

var token, projectId, refreshToken, userId;

describe('Jwt Token API', function () {
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
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        refreshToken = res.body.tokens.jwtRefreshToken;
                        done();
                    });
                });
            });
        });
    });

    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId });
    });

    it('should get new access and refresh token when provided a valid jwtRefreshToken', function (done) {
        var authorization = `Basic ${token}`;
        request.post('/token/new').set('Authorization', authorization)
            .send({ refreshToken: refreshToken }).end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});