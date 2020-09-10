/* eslint-disable linebreak-style, no-undef */

process.env.PORT = 3020;
process.env.ENCRYPTION_KEY = '01234567890123456789012345678901';
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

let projectId, userId, airtableId, token;

describe('Tutorial API', function() {
    this.timeout(80000);

    before(function(done) {
        this.timeout(120000);
        GlobalConfig.initTestConfig().then(function() {
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
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await AirtableService.deleteUser(airtableId);
    });

    it('should get the user tutorial status', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get('/tutorial')
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body._id).to.be.equal(userId);
                done();
            });
    });

    it('should update the user tutorial status', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type: 'monitor',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body._id).to.be.equal(userId);
                done();
            });
    });

    it('should update the user custom component tutorial status per project', function(done) {
        const authorization = `Basic ${token}`;
        const type = 'component';
        request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type,
                projectId,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data[projectId]).to.be.an('object');
                expect(res.body.data[projectId][type]).to.be.an('object');
                expect(res.body.data[projectId][type].show).to.be.equal(false);
                done();
            });
    });
    it('should update the user custom team memb er tutorial status per project', function(done) {
        const authorization = `Basic ${token}`;
        const type = 'teamMember';
        request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type,
                projectId,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data[projectId]).to.be.an('object');
                expect(res.body.data[projectId][type]).to.be.an('object');
                expect(res.body.data[projectId][type].show).to.be.equal(false);
                done();
            });
    });
    it('should get the user tutorial status for a project', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get('/tutorial')
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body._id).to.be.equal(userId);
                expect(res.body.data[projectId]).to.be.an('object');
                expect(res.body.data[projectId].component.show).to.be.equal(
                    false
                );
                expect(res.body.data[projectId].teamMember.show).to.be.equal(
                    false
                );
                done();
            });
    });
});
