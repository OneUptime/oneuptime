/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const IncidentSettings = require('../backend/services/incidentSettingsService');
const ProjectService = require('../backend/services/projectService');
const {
    incidentDefaultSettings,
} = require('../backend/config/incidentDefaultSettings');
const VerificationTokenModel = require('../backend/models/verificationToken');
const GlobalConfig = require('./utils/globalConfig');

let token, userId, projectId;

describe('Incident Priority API', function() {
    this.timeout(500000);
    before(function(done) {
        this.timeout(90000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                projectId = res.body.project._id;
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
        await IncidentSettings.hardDeleteBy({ projectId: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await ProjectService.hardDeleteBy({ _id: projectId });
    });

    it('Should return the list of the available variables.', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.eql(2);
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.eql(2);
        expect(res.body.data[0]).to.have.property('name');
        expect(res.body.data[0].name).to.eql('High');
        expect(res.body.data[1]).to.have.property('name');
        expect(res.body.data[1].name).to.eql('Low');
    });
});
