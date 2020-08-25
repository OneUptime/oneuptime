/* eslint-disable no-undef */

process.env.PORT = 3020;
const HTTP_TEST_SERVER_URL = 'http://localhost:3010';
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const testServer = chai.request(HTTP_TEST_SERVER_URL);
const { createUser } = require('./utils/userSignUp');

const incidentData = require('./data/incident');
const UserService = require('../backend/services/userService');
const UserModel = require('../backend/models/user');
const ProjectService = require('../backend/services/projectService');
const ProjectModel = require('../backend/models/project');
const IncidentService = require('../backend/services/incidentService');
const MonitorService = require('../backend/services/monitorService');
const NotificationService = require('../backend/services/notificationService');
const IntegrationService = require('../backend/services/integrationService');
const AirtableService = require('../backend/services/airtableService');
const Config = require('./utils/config');
const VerificationTokenModel = require('../backend/models/verificationToken');
const AlertModel = require('../backend/models/alert');
const GlobalConfig = require('./utils/globalConfig');
const ComponentModel = require('../backend/models/component');
const sleep = waitTimeInMs =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let token,
    userId,
    airtableId,
    projectId,
    monitorId,
    componentId;

    const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Incident Settings API', function() {
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
                                    const authorization = `Basic ${token}`;
                                    ComponentModel.create({
                                        name: 'New Component',
                                        projectId,
                                    }).then(component => {
                                        componentId = component._id;
                                        request
                                            .post(`/monitor/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({ ...monitor, componentId })
                                            .end(async function(err, res) {
                                                monitorId = res.body._id;
                                                expect(res).to.have.status(200);
                                                expect(
                                                    res.body.name
                                                ).to.be.equal(monitor.name);
                                                done();
                                            });
                                    });
                                });
                        });
                });
            });
        });
    });

  after(async function() {
  });

  it("should return the list of the available variables", async ()=>{
    const authorization = `Basic ${token}`;
    const res = await request
      .get(`/incidentSettings/variables`)
      .set('Authorization', authorization);
    expect(res).to.have.status(200);
    expect(res.body).to.be.an('array');
  });

});