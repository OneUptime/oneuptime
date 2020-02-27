process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');

let token, projectId, refreshToken, userId, airtableId;

describe('Jwt Token API', function() {
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
                                refreshToken = res.body.tokens.jwtRefreshToken;
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
        await AirtableService.deleteUser(airtableId);
    });

    it('should get new access and refresh token when provided a valid jwtRefreshToken', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post('/token/new')
            .set('Authorization', authorization)
            .send({ refreshToken: refreshToken })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
