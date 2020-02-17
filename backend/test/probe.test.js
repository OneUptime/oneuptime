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
const AirtableService = require('../backend/services/airtableService');
const request = chai.request.agent(app);
const clusterKey = require('../backend/config/keys').clusterKey;
const ProbeService = require('../backend/services/probeService');
let probeId;
let token, userId, airtableId, projectId;

describe('Probe API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function (err, res) {
            const project = res.body.project;
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
        await ProbeService.hardDeleteBy({ _id: probeId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await AirtableService.deleteUser(airtableId);
    });

    it('should add a probe by admin', function (done) {
        const authorization = `Basic ${token}`;
        request.post('/probe/').set('Authorization', authorization).send({
            probeName: 'New Probe',
            clusterKey: clusterKey,
        }).end(function (err, res) {
            probeId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.probeName).to.be.equal('New Probe');
            done();
        });
    });

    it('should not add a probe if not admin', function (done) {
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
                            probeName: 'New Probe',
                            clusterKey: '',
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
        request.post('/probe/').set('Authorization', authorization).send({
            probeName: 'New Probe',
            clusterKey: clusterKey,
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should get a list of probe by admin', function (done) {
        const authorization = `Basic ${token}`;
        request.get('/probe/').set('Authorization', authorization).send({
            clusterKey: clusterKey,
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });

    it('should delete a probe by admin', function (done) {
        const authorization = `Basic ${token}`;
        request.delete(`/probe/${probeId}`).set('Authorization', authorization).send({
            clusterKey: clusterKey,
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });
});
