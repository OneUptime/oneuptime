process.env['PORT'] = 3020;
import chai, { expect } from 'chai';
import ObjectID from 'Common/Types/ObjectID';

import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request: $TSFixMe = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import EmailLogsService from '../backend/services/emailStatusService';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import VerificationTokenModel from '../backend/models/verificationToken';

let token: $TSFixMe, projectId: ObjectID, userId: ObjectID;
let testSuiteStartTime: $TSFixMe, testCaseStartTime: $TSFixMe;

describe('Email Logs API', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        testSuiteStartTime = new Date();
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        (err: $TSFixMe, verificationToken: $TSFixMe): void => {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end((): void => {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            done();
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async (): void => {
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

        /*
         * Deleting any emailLogs created between this test suite.
         * Note that using timeStamp between this test suite to remove some logs, Beacuse some email logs dont contain specific 'userId'. (Ex. /login)
         */
        const deleteQuery: $TSFixMe = {
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
        await EmailLogsService.hardDeleteBy({ query: deleteQuery });
    });

    beforeEach(async (): void => {
        testCaseStartTime = new Date();
    });

    afterEach(async (): void => {
        /*
         * Deleting any emailLogs created between each test case in this suite.
         * Note that using timeStamp between this test suite to remove some logs, Beacuse some email logs dont contain specific 'userId'. (Ex. /login)
         */
        const deleteQuery: $TSFixMe = {
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
        await EmailLogsService.hardDeleteBy({
            query: deleteQuery,
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
    });

    it('should reject get email logs request of an unauthenticated user', (done: $TSFixMe): void => {
        request
            .get('/email-logs')
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should reject get email logs request of NON master-admin user', async (): void => {
        const authorization: string = `Basic ${token}`;
        await UserService.updateBy({ _id: userId }, { role: 'user' }); // Assigning user role

        const res: $TSFixMe = await request
            .get('/email-logs/')
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(400);
    });

    it('should send get email logs data for master-admin user', async (): void => {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization: string = `Basic ${token}`;

        const res: $TSFixMe = await request
            .get('/email-logs/')
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should send appopriate data set when limit is provided', async (): void => {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization: string = `Basic ${token}`;

        // Creating Email Logs.
        await GlobalConfig.enableEmailLog();
        await createUser(request, userData.newUser);
        await createUser(request, userData.anotherUser);
        const res: $TSFixMe = await request
            .get('/email-logs/')
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

    it('should send appopriate data set when skip is provided', async (): void => {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization: string = `Basic ${token}`;

        // Creating Email Logs.
        await GlobalConfig.enableEmailLog();
        await createUser(request, userData.newUser);
        await createUser(request, userData.anotherUser);

        const noOfEmailLogsNow: $TSFixMe = await EmailLogsService.countBy({});

        const res: $TSFixMe = await request
            .get('/email-logs/')
            .query({ skip: noOfEmailLogsNow - 2 })
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');
        expect(res.body.data.length).to.be.equal(2);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should reject search request of an unauthenticated user', (done: $TSFixMe): void => {
        request
            .post('/email-logs/search')
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should reject search request of NON master-admin user', async (): void => {
        await UserService.updateBy({ _id: userId }, { role: 'user' }); // Resetting user to normal USER.
        const authorization: string = `Basic ${token}`;

        try {
            await request
                .post('/email-logs/search')
                .set('Authorization', authorization)
                .send();
        } catch (err) {
            expect(err).to.have.status(400);
        }
    });

    it('should send Searched EmailLogs data for master-admin user', async (): void => {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization: string = `Basic ${token}`;

        const res: $TSFixMe = await request
            .post('/email-logs/search')
            .set('Authorization', authorization)
            .send();

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });

    it('should send only matched result to provided search string when searched.', async (): void => {
        await UserService.updateBy({ _id: userId }, { role: 'master-admin' }); // Making user a "MASTER-ADMIN"
        const authorization: string = `Basic ${token}`;

        // Just making three API request to make Logs.
        await request.get('/version');
        await request.get('/version');
        await request
            .get('/user/users/' + userId)
            .set('Authorization', authorization)
            .send();

        const searchString: string = '/vers';
        const res: $TSFixMe = await request
            .post('/email-logs/search')
            .set('Authorization', authorization)
            .send({
                filter: searchString,
            });

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body).to.have.property('count');

        // Checking searchResult match provided searchString.
        const isEverySearchedApiUrlMatch: $TSFixMe = res.body.data.every(
            (result: $TSFixMe) => {
                return result.request.apiUrl.includes(searchString);
            }
        );
        expect(isEverySearchedApiUrlMatch).to.be.equal(true);

        await UserService.updateBy({ _id: userId }, { role: 'null' }); // Resetting user to normal USER.
    });
});
