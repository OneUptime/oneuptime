// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import EmailStatusService from '../backend/services/emailStatusService';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Email verification API', function() {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            GlobalConfig.enableEmailLog().then(function() {
                createUser(request, userData.user, function(
                    err: $TSFixMe,
                    res: $TSFixMe
                ) {
                    userId = res.body.id;
                    projectId = res.body.project._id;

                    done();
                });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
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
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 2.
        await ProjectService.hardDeleteBy({ _id: projectId }, userId);
        await AirtableService.deleteAll({ tableName: 'User' });
        await EmailStatusService.hardDeleteBy({});
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should send email verification', async function() {
        await sleep(10000);

        const emailStatuses = await EmailStatusService.findBy({
            query: {},
            select: selectEmailStatus,
        });
        expect(emailStatuses[0].subject).to.equal('Welcome to OneUptime.');
        expect(emailStatuses[0].status).to.equal('Success');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not login non-verified user', async function() {
        try {
            await request.post('/user/login').send({
                email: userData.user.email,
                password: userData.user.password,
            });
        } catch (error) {
            expect(error).to.have.status(401);
        }
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should verify the user', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should login the verified user', async function() {
        const res = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        expect(res).to.have.status(200);
    });
});
