process.env.PORT = 3020;
var chai = require('chai');
var expect = require('chai').expect;

var userData = require('./data/user');
var app = require('../server');
chai.use(require('chai-http'));
var request = chai.request.agent(app);

var { createUser } = require('./utils/userSignUp');
var AuditLogsService = require('../backend/services/auditLogsService');
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var AirtableService = require('../backend/services/airtableService');
var VerificationTokenModel = require('../backend/models/verificationToken');

var token, projectId, userId, airtableId;
var testSuiteStartTime, testCaseStartTime;

describe('Audit Logs API', function() {
    this.timeout(30000);

    before(function(done) {
        testSuiteStartTime = new Date();
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            let project = res.body.project;
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
                                password: userData.user.password
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
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email
                ]
            }
        });
        await AirtableService.deleteUser(airtableId);

        // Deleting any auditLogs created between this test suite.
        // Note that using timeStamp between this test suite to remove some logs, Beacuse some audit logs dont contain specific 'userId'. (Ex. /login)
        const deleteQuery = {
            $or: [
                { userId: userId },
                {
                    createdAt: {
                        $gte: testSuiteStartTime,
                        $lte: new Date()
                    }
                }
            ]
        };
        await AuditLogsService.hardDeleteBy({ query: deleteQuery });
    });

    beforeEach(async function() {
        testCaseStartTime = new Date();
    });

    afterEach(async function() {
        // Deleting any auditLogs created between each test case in this suite.
        // Note that using timeStamp between this test suite to remove some logs, Beacuse some audit logs dont contain specific 'userId'. (Ex. /login)
        const deleteQuery = {
            $or: [
                { userId: userId },
                {
                    createdAt: {
                        $gte: testCaseStartTime,
                        $lte: new Date()
                    }
                }
            ]
        };
        await AuditLogsService.hardDeleteBy({
            query: deleteQuery
        });
    });

    it('should reject get audit logs request of an unauthenticated user', function(done) {
        request
            .get('/audit-logs')
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should reject get audit logs request of NON master-admin user', function(done) {
        var authorization = `Basic ${token}`;

        request
            .get('/audit-logs/')
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should send get audit logs data for master-admin user', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        var authorization = `Basic ${token}`;

        const res = await request
            .get('/audit-logs/')
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should send appopriate data set when limit is provided', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        var authorization = `Basic ${token}`;

        // Just making three API request to make Logs.
        await request.get('/version');
        await request.get('/version');
        await request.get('/version');

        const res = await request
            .get('/audit-logs/')
            .query({ limit: 2 })
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.data.length).to.be.equal(2);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should send appopriate data set when skip is provided', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        var authorization = `Basic ${token}`;

        // Just making three API request to make Logs.
        await request.get('/version');
        await request.get('/version');
        await request.get('/version');

        const noOfAuditLogsNow = await AuditLogsService.countBy({});

        const res = await request
            .get('/audit-logs/')
            .query({ skip: noOfAuditLogsNow - 2 })
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.data.length).to.be.equal(2);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should reject search request of an unauthenticated user', function(done) {
        request
            .post('/audit-logs/search')
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should reject search request of NON master-admin user', function(done) {
        var authorization = `Basic ${token}`;

        request
            .post('/audit-logs/search')
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should send Searched AuditLogs data for master-admin user', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        var authorization = `Basic ${token}`;

        const res = await request
            .post('/audit-logs/search')
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should send only matched result to provided search string when searched.', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        var authorization = `Basic ${token}`;

        // Just making three API request to make Logs.
        await request.get('/version');
        await request.get('/version');
        await request
            .get('/user/users/' + userId)
            .set('Authorization', authorization)
            .send();

        const searchString = '/vers';
        const res = await request
            .post('/audit-logs/search')
            .set('Authorization', authorization)
            .send({
                filter: searchString
            });

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        // Checking searchResult match provided searchString.
        const isEverySearchedApiUrlMatch = res.body.data.every(result => {
            return result.request.apiUrl.includes(searchString);
        });
        expect(isEverySearchedApiUrlMatch).to.be.equal(true);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });
});
