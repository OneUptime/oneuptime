/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const data = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');
const GlobalConfigService = require('../backend/services/globalConfigService');
const VerificationTokenModel = require('../backend/models/verificationToken');

let projectId, userId, airtableId, token;

describe('Global Config API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        createUser(request, data.user, function(err, res) {
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
                                email: data.user.email,
                                password: data.user.password,
                            })
                            .end(function(err, res) {
                                token = res.body.tokens.jwtAccessToken;
                                UserService.updateBy(
                                    { _id: userId },
                                    { role: 'master-admin' }
                                ).then(function() {
                                    done();
                                });
                            });
                    });
            });
        });
    });

    after(async () => {
        await UserService.hardDeleteBy({ email: data.user.email });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await AirtableService.deleteUser(airtableId);
        await GlobalConfigService.hardDeleteBy({
            name: { $in: ['TestName', 'Other TestName'] },
        });
    });

    it('should create global config when name and value are valid', function(done) {
        const authorization = `Basic ${token}`;
        const globalConfig = {
            name: 'TestName',
            value: 'TestValue',
        };
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfig)
            .end(async function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal(globalConfig.name);
                expect(res.body.value).to.equal(globalConfig.value);
                done();
            });
    });

    it('should create multiple global configs when details are valid', function(done) {
        const authorization = `Basic ${token}`;
        const globalConfigs = [
            {
                name: 'TestName',
                value: 'TestValue',
            },
            {
                name: 'Other TestName',
                value: 'Other TestValue',
            },
        ];
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfigs)
            .end(async function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data.length).to.equal(2);
                expect(res.body.data[0]).to.have.property('name');
                expect(res.body.data[0]).to.have.property('value');
                expect(res.body.data[0].name).to.equal(globalConfigs[1].name);
                expect(res.body.data[0].value).to.equal(globalConfigs[1].value);
                expect(res.body.data[1]).to.have.property('name');
                expect(res.body.data[1]).to.have.property('value');
                expect(res.body.data[1].name).to.equal(globalConfigs[0].name);
                expect(res.body.data[1].value).to.equal(globalConfigs[0].value);
                done();
            });
    });

    it('should not create global config when name and value are not valid', function(done) {
        const authorization = `Basic ${token}`;
        const globalConfig = { name: null };
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfig)
            .end(async function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get multiple global configs when names are provided', function(done) {
        const authorization = `Basic ${token}`;
        const globalConfigs = ['TestName', 'Other TestName'];
        request
            .post('/globalConfig/configs')
            .set('Authorization', authorization)
            .send(globalConfigs)
            .end(async function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data.length).to.equal(2);
                expect(res.body.data[0]).to.have.property('name');
                expect(res.body.data[0]).to.have.property('value');
                expect(res.body.data[0].name).to.equal('Other TestName');
                expect(res.body.data[1]).to.have.property('name');
                expect(res.body.data[1]).to.have.property('value');
                expect(res.body.data[1].name).to.equal('TestName');
                done();
            });
    });

    it('should get global config by name', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get('/globalConfig/TestName')
            .set('Authorization', authorization)
            .end(async function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('TestName');
                done();
            });
    });
});
