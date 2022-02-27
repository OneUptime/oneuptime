// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import projectData from './data/project'
import chai from 'chai'
chai.use(require(..p'));
import app from '../server'

import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import NotificationService from '../backend/services/notificationService'
import AirtableService from '../backend/services/airtableService'
import GlobalConfig from './utils/globalConfig'
import VerificationTokenModel from '../backend/models/verificationToken'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'

let projectId: $TSFixMe, token: $TSFixMe, userId;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Notification API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
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
                                .end(function(err: $TSFixMe, res: $TSFixMe) {
                                    token = res.body.tokens.jwtAccessToken;
                                    done();
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
        await ProjectService.hardDeleteBy({});
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a new notification', (done: $TSFixMe) => {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get project notifications current user is present in', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not get project notifications current user is not present in', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/notification/${projectData.firstProject._id}`)
            .set('Authorization', authorization)
            .send()
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should mark project notification as read', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                const notificationId = res.body._id;
                request
                    .put(`/notification/${projectId}/read`)
                    .set('Authorization', authorization)
                    .send({ notificationIds: [notificationId] })
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('array');
                        expect(res.body).to.include(notificationId);
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should close a notification', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                const notificationId = res.body._id;
                request
                    .put(`/notification/${projectId}/${notificationId}/closed`)
                    .set('Authorization', authorization)
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body._id).to.be.equal(notificationId);
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should mark all project notifications as read', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/notification/${projectId}`)
            .set('Authorization', authorization)
            .send({
                message: 'New Notification',
                icon: 'bell',
            })
            .end(function() {
                request
                    .put(`/notification/${projectId}/readAll`)
                    .set('Authorization', authorization)
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject request if the notification param is invalid ', function(done: $TSFixMe) {
        request
            .put(`/notification/${projectId}/read`)
            .send({ notificationIds: [projectData.fakeProject._id] })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(401);
                done();
            });
    });
});
