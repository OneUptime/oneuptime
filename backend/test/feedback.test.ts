// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require(..p'));
import app from '../server'
import EmailStatusService from '../backend/services/emailStatusService'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import FeedbackService from '../backend/services/feedbackService'
import ProjectService from '../backend/services/projectService'
import VerificationTokenModel from '../backend/models/verificationToken'
import AirtableService from '../backend/services/airtableService'
import GlobalConfig from './utils/globalConfig'
const selectEmailStatus =
    'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

let token: $TSFixMe, projectId: $TSFixMe, userId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Feedback API', function(this: $TSFixMe) {
    this.timeout(50000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            GlobalConfig.enableEmailLog().then(function() {
                createUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
                    const project = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne({ userId }, function(
                        err: $TSFixMe,
                        verificationToken: $TSFixMe
                    ) {
                        request
                            .get(
                                `/user/confirmation/${verificationToken.token}`
                            )
                            .redirects(0)
                            .end(function() {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: userData.user.email,
                                        password: userData.user.password,
                                    })
                                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                                        token = res.body.tokens.jwtAccessToken;
                                        done();
                                    });
                            });
                    });
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
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create feedback and check the sent emails to oneuptime team and user', async function() {
        const authorization = `Basic ${token}`;
        const testFeedback = {
            feedback: 'test feedback',
            page: 'test page',
        };
        const res = await request
            .post(`/feedback/${projectId}`)
            .set('Authorization', authorization)
            .send(testFeedback);
        expect(res).to.have.status(200);
        await FeedbackService.hardDeleteBy({ _id: res.body._id });
        await AirtableService.deleteFeedback(res.body.airtableId);
        const emailStatuses = await EmailStatusService.findBy({
            query: {},
            select: selectEmailStatus,
        });
        if (emailStatuses[0].subject.includes('Thank you')) {
            expect(emailStatuses[0].subject).to.equal(
                'Thank you for your feedback!'
            );
        } else {
            const subject = 'Welcome to OneUptime.';
            const status = emailStatuses.find(
                (status: $TSFixMe) => status.subject === subject
            );
            expect(status.subject).to.equal(subject);
        }
    });
});
