process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');

let UserService = require('../backend/services/userService');
let ProjectService = require('../backend/services/projectService');
let AirtableService = require('../backend/services/airtableService');

let VerificationTokenModel = require('../backend/models/verificationToken');

let request = chai.request.agent(app);
let { createUser } = require('./utils/userSignUp');

let token, projectId, refreshToken, userId, airtableId;

describe('Jwt Token API', function () {
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
        await AirtableService.deleteUser(airtableId);
    });

    it('should get new access and refresh token when provided a valid jwtRefreshToken', function (done) {
        let authorization = `Basic ${token}`;
        request.post('/token/new').set('Authorization', authorization)
            .send({ refreshToken: refreshToken }).end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});