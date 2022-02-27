const expect = require('chai').expect;
// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
import userData from './data/user'
import chai from 'chai'
chai.use(require(..p'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import EmailTemplateService from '../backend/services/emailTemplateService'
import NotificationService from '../backend/services/notificationService'
import VerificationTokenModel from '../backend/models/verificationToken'
import AirtableService from '../backend/services/airtableService'

let token: $TSFixMe, projectId: $TSFixMe, emailTemplateId: $TSFixMe, userId;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Email Template API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function(this: $TSFixMe) {
        this.timeout(40000);
        await GlobalConfig.initTestConfig();

        const res = await createUser(request, userData.user);
        const project = res.body.project;
        projectId = project._id;
        userId = res.body.id;

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        const res1 = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = res1.body.tokens.jwtAccessToken;
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
        await ProjectService.hardDeleteBy({ _id: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await EmailTemplateService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /:projectId'
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an email template with valid data', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/emailTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send({
                subject: 'Mail Subject',
                body: 'Mail Body',
                emailType: 'Subscriber Incident Created',
            });
        emailTemplateId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.subject).to.be.equal('Mail Subject');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should sanitize dirty template data sent to endpoint', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/emailTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send({
                subject: 'Mail Subject',
                body: '<img src=x onerror=alert(1)//>',
                emailType: 'Subscriber Incident Created',
            });
        expect(res).to.have.status(200);
        expect(res.body.body).to.be.equal(
            '<html><head></head><body><img src="x"></body></html>'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get an array of email templates by valid projectId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/emailTemplate/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get an email template by valid emailTemplateId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update an email template by valid emailTemplateId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .put(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`)
            .set('Authorization', authorization)
            .send({
                subject: 'New Mail Subject',
            });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.subject).to.be.equal('New Mail Subject');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update default email template', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .put(`/emailTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send([
                {
                    subject: 'Updated Mail Subject',
                    body: 'Updated Mail Body',
                    emailType: 'Subscriber Incident Acknowledged',
                },
            ]);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body[1].subject).to.be.equal('Updated Mail Subject');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should deleted an email template', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .delete(
                `/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`
            )
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body.deleted).to.be.equal(true);
    });
});
