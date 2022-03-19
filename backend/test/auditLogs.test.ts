process.env.PORT = 3020;
import chai from 'chai';
const expect = require('chai').expect;

import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import AuditLogsService from '../backend/services/auditLogsService';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import VerificationTokenModel from '../backend/models/verificationToken';

let token: $TSFixMe, projectId: $TSFixMe, userId: $TSFixMe;
let testSuiteStartTime: $TSFixMe, testCaseStartTime: $TSFixMe;

describe('Audit Logs API', function() {
    this.timeout(30000);

    before(function(done: $TSFixMe) {
        testSuiteStartTime = new Date();
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(
                err: $TSFixMe,
                res: Response
            ) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    err: $TSFixMe,
                    verificationToken: $TSFixMe
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
                                .end(function(err: $TSFixMe, res: Response) {
                                    token = res.body.tokens.jwtAccessToken;
                                    done();
                                });
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
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.removeTestConfig();

        // Deleting any auditLogs created between this test suite.
        // Note that using timeStamp between this test suite to remove some logs, Beacuse some audit logs dont contain specific 'userId'. (Ex. /login)
        const deleteQuery = {
            $or: [
                { userId: userId },
                {
                    createdAt: {
                        $gte: testSuiteStartTime,
                        $lte: new Date(),
                    },
                },
            ],
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
                        $lte: new Date(),
                    },
                },
            ],
        };
        await AuditLogsService.hardDeleteBy({
            query: deleteQuery,
        });
    });

    it('should reject get audit logs request of an unauthenticated user', function(done: $TSFixMe) {
        request
            .get('/audit-logs')
            .send()
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should reject get audit logs request of NON master-admin user', function(done: $TSFixMe) {
        createUser(request, userData.newUser, function() {
            request
                .post('/user/login')
                .send({
                    email: userData.newUser.email,
                    password: userData.newUser.password,
                })
                .end(function(err: $TSFixMe, res: Response) {
                    const token = res.body.tokens.jwtAccessToken;
                    const authorization = `Basic ${token}`;

                    request
                        .get('/audit-logs/')
                        .set('Authorization', authorization)
                        .send()
                        .end(function(err: $TSFixMe, res: Response) {
                            expect(res).to.have.status(400);
                            done();
                        });
                });
        });
    });

    it('should send get audit logs data for master-admin user', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization = `Basic ${token}`;

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
        const authorization = `Basic ${token}`;

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
        const authorization = `Basic ${token}`;

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
        expect(res.body.data.length).to.be.equal(3);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should reject search request of an unauthenticated user', function(done: $TSFixMe) {
        request
            .post('/audit-logs/search')
            .send()
            .end(function(err: $TSFixMe, res: Response) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should reject search request of NON master-admin user', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'user' }); // Resetting user to normal USER.
        const authorization = `Basic ${token}`;

        try {
            await request
                .post('/audit-logs/search')
                .set('Authorization', authorization)
                .send();
        } catch (err) {
            expect(err).to.have.status(400);
        }
    });

    it('should send Searched AuditLogs data for master-admin user', async function() {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization = `Basic ${token}`;

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
        const authorization = `Basic ${token}`;

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
                filter: searchString,
            });

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        // Checking searchResult match provided searchString.
        const isEverySearchedApiUrlMatch = res.body.data.every(
            (result: $TSFixMe) => {
                return result.request.apiUrl.includes(searchString);
            }
        );
        expect(isEverySearchedApiUrlMatch).to.be.equal(true);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });
});
