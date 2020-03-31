/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const data = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createEnterpriseUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');
const VerificationTokenModel = require('../backend/models/verificationToken');

let projectId, newProjectId, userId, userRole, airtableId, newAirtableId;

describe('Enterprise User API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createEnterpriseUser(request, data.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;
                userRole = res.body.role;
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
                                    email: data.user.email,
                                    password: data.user.password,
                                })
                                .end(function() {
                                    done();
                                });
                        });
                });
            });
        });
    });

    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [data.user.email, data.newUser.email],
            },
        });
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await AirtableService.deleteUser(airtableId);
        await AirtableService.deleteUser(newAirtableId);
    });

    it('should sign up initial user as `master-admin`', function() {
        expect(userRole).to.equal('master-admin');
    });

    it('should confirm that `master-admin` exists', function(done) {
        request.get('/user/masterAdminExists').end(function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body).have.property('result');
            expect(res.body.result).to.eql(true);
            done();
        });
    });

    // 'post /user/signup'
    it('should register `user` without stripeToken, stripePlanId', function(done) {
        createEnterpriseUser(request, data.newUser, function(err, res) {
            const project = res.body.project;
            newProjectId = project._id;
            newAirtableId = res.body.airtableId;
            expect(res).to.have.status(200);
            expect(res.body.email).to.equal(data.newUser.email);
            expect(res.body.role).to.equal('user');
            done();
        });
    });

    it('should login with valid credentials', function(done) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                expect(res.body).include.keys('tokens');
                done();
            });
    });

    it('should login with valid credentials, and return sent redirect url', function(done) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
                redirect: 'http://fyipe.com',
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(data.newUser.email);
                expect(res.body).have.property('redirect');
                expect(res.body.redirect).to.eql('http://fyipe.com');
                done();
            });
    });
});
