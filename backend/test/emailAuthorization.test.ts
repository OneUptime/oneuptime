process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import EmailStatusService from '../backend/services/emailStatusService';

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import VerificationTokenModel from '../backend/models/verificationToken';
import AirtableService from '../backend/services/airtableService';

const sleep = (waitTimeInMs: $TSFixMe) =>
    new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let userId: $TSFixMe, projectId: $TSFixMe;

const selectEmailStatus =
    'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

describe('Email verification API', function () {
    this.timeout(20000);

    before(function (done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function () {
            GlobalConfig.enableEmailLog().then(function () {
                createUser(
                    request,
                    userData.user,
                    function (err: $TSFixMe, res: Response) {
                        userId = res.body.id;
                        projectId = res.body.project._id;

                        done();
                    }
                );
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });

        await ProjectService.hardDeleteBy({ _id: projectId }, userId);
        await AirtableService.deleteAll({ tableName: 'User' });
        await EmailStatusService.hardDeleteBy({});
    });

    it('should send email verification', async function () {
        await sleep(10000);

        const emailStatuses = await EmailStatusService.findBy({
            query: {},
            select: selectEmailStatus,
        });
        expect(emailStatuses[0].subject).to.equal('Welcome to OneUptime.');
        expect(emailStatuses[0].status).to.equal('Success');
    });

    it('should not login non-verified user', async function () {
        try {
            await request.post('/user/login').send({
                email: userData.user.email,
                password: userData.user.password,
            });
        } catch (error) {
            expect(error).to.have.status(401);
        }
    });

    it('should verify the user', async function () {
        const token = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${token.token}`).redirects(0);
        } catch (error) {
            expect(error).to.have.status(302);
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'isVerified',
            });
            expect(user.isVerified).to.be.equal(true);
        }
    });

    it('should login the verified user', async function () {
        const res = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        expect(res).to.have.status(200);
    });
});
