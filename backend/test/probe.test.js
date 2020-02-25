process.env.PORT = 3020;
const expect = require('chai').expect;
const chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
const app = require('../server');
const userData = require('./data/user');
const { createUser } = require('./utils/userSignUp');
const VerificationTokenModel = require('../backend/models/verificationToken');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const request = chai.request.agent(app);
const ProbeService = require('../backend/services/probeService');
let probeId;
let token, userId, projectId;
const probeKey = 'test-key';
const generateRandomString = require('./utils/string').generateRandomString;

describe('Probe API', function () {
    this.timeout(20000);

    before(async function () {
        this.timeout(40000);
        await UserService.create({
            ...userData.user,
            role: 'master-admin'
        });

        const response = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });

        token = response.body.tokens.jwtAccessToken;
        return Promise.resolve();
        
    });

    after(async function () {
        await ProbeService.hardDeleteBy({ _id: probeId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
    });

    it('should add a probe by admin', function (done) {
        const authorization = `Basic ${token}`;
        const probeName = generateRandomString();
        request.post('/probe/').set('Authorization', authorization).send({
            probeName: probeName,
            probeKey: probeKey,
        }).end(function (err, res) {
            probeId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.probeName).to.be.equal(probeName);
            done();
        });
    });

    it('should not add a probe if not admin', function (done) {
        const probeName = generateRandomString();
        createUser(request, userData.newUser, function (err, res) {
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.newUser.email,
                        password: userData.newUser.password
                    }).end(function (err, res) {
                        const authorization = `Basic ${res.body.tokens.jwtAccessToken}`;
                        request.post('/probe/').set('Authorization', authorization).send({
                            probeName: probeName,
                            probeKey: '',
                        }).end(function (err, res) {
                            expect(res).to.have.status(400);
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should reject a probe if same name already exists', function (done) {
        const authorization = `Basic ${token}`;
        const probeName = generateRandomString();
        request.post('/probe/').set('Authorization', authorization).send({
            probeName: probeName,
            probeKey: probeKey,
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            request.post('/probe/').set('Authorization', authorization).send({
                probeName: probeName,
                probeKey: probeKey,
            }).end(function (err, res) {
                expect(res).to.have.status(400);
                done();
            });
        });
        
    });

    it('should get probes', function (done) {
        const authorization = `Basic ${token}`;
        request.get('/probe/').set('Authorization', authorization).send().end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });

    it('should delete a probe by admin', function (done) {
        const authorization = `Basic ${token}`;
        const probeName = generateRandomString();
        request.post('/probe/').set('Authorization', authorization).send({
            probeName: probeName,
            probeKey: probeKey,
        }).end(function (err, res) {
            probeId = res.body._id;
            expect(res).to.have.status(200);
            request.delete(`/probe/${probeId}`).set('Authorization', authorization).send().end(function (err, res) {
                expect(res).to.have.status(200);
                done();
            });
        });
    });
});
