// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chaihttp);
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import SmsTemplateService from '../backend/services/smsTemplateService'
import NotificationService from '../backend/services/notificationService'
import AirtableService from '../backend/services/airtableService'

import VerificationTokenModel from '../backend/models/verificationToken'

let token: $TSFixMe, projectId: $TSFixMe, userId, smsTemplateId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('SMS Template API', function() {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
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
        await SmsTemplateService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // 'post /:projectId'
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an sms template with valid data', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/smsTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send({
                body: 'SMS Body',
                smsType: 'Subscriber Incident Created',
            });
        smsTemplateId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.body).to.be.equal('SMS Body');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should sanitize dirty template data sent to endpoint', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/smsTemplate/${projectId}`)
            .set('Authorization', authorization)
            .send({
                body: '<img src=x onerror=alert(1)//>',
                smsType: 'Subscriber Incident Created',
            });
        expect(res).to.have.status(200);
        expect(res.body.body).to.be.equal('<img src="x">');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get an array of sms templates by valid projectId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/smsTemplate/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get an sms template by valid smsTemplateId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/smsTemplate/${projectId}/smsTemplate/${smsTemplateId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update an sms template by valid smsTemplateId', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .put(`/smsTemplate/${projectId}/smsTemplate/${smsTemplateId}`)
            .send({
                body: 'New SMS Body',
            })
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.body).to.be.equal('New SMS Body');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update default sms template', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .put(`/smsTemplate/${projectId}`)
            .send([
                {
                    body: 'Updated SMS Body',
                    smsType: 'Subscriber Incident Acknowledged',
                },
            ])
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        expect(res.body[1].body).to.be.equal('Updated SMS Body');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should deleted an sms template', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .delete(`/smsTemplate/${projectId}/smsTemplate/${smsTemplateId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
    });
});
