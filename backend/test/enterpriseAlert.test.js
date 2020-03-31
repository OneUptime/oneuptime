/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const incidentData = require('./data/incident');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createEnterpriseUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const MonitorService = require('../backend/services/monitorService');
const IncidentService = require('../backend/services/incidentService');
const AlertService = require('../backend/services/alertService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

let token, projectId, userId, airtableId, monitorId, incidentId, alertId;

describe('Enterprise Alert API', function() {
    this.timeout(30000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
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
                                    const authorization = `Basic ${token}`;
                                    request
                                        .post(`/monitor/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send({
                                            name: 'New Monitor',
                                            type: 'url',
                                            data: {
                                                url: 'http://www.tests.org',
                                            },
                                        })
                                        .end(function(err, res) {
                                            monitorId = res.body._id;
                                            done();
                                        });
                                });
                        });
                });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({ email: userData.user.email });
        await IncidentService.hardDeleteBy({ _id: incidentId });
        await AlertService.hardDeleteBy({ _id: alertId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should create alert with valid details for project with no billing plan', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end(function(err, res) {
                incidentId = res.body._id;
                request
                    .post(`/alert/${projectId}`)
                    .set('Authorization', authorization)
                    .send({
                        monitorId,
                        alertVia: 'email',
                        incidentId,
                    })
                    .end(function(err, res) {
                        alertId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        done();
                    });
            });
    });
});
