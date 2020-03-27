/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createEnterpriseUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

let token, projectId, newProjectId, userId, airtableId;

describe('Enterprise Team API', function() {
    this.timeout(30000);

    before(function(done) {
        this.timeout(40000);
        createEnterpriseUser(request, userData.user, function(err, res) {
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
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await UserService.hardDeleteBy({ email: userData.user.email });
        await AirtableService.deleteUser(airtableId);
    });

    it('should add new user with valid details for project with no billing plan', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: 'noreply1@fyipe.com',
                role: 'Member',
            })
            .end(function(err, res) {
                anotherUser = res.body[0].team[0].userId;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
});
