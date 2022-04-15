import { expect } from 'chai';

process.env.PORT = 3020;
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import EmailTemplateService from '../backend/services/emailTemplateService';
import NotificationService from '../backend/services/notificationService';
import VerificationTokenModel from '../backend/models/verificationToken';
import AirtableService from '../backend/services/airtableService';

let token: $TSFixMe,
    projectId: ObjectID,
    emailTemplateId: $TSFixMe,
    userId: $TSFixMe;

describe('Email Template API', function (): void {
    this.timeout(20000);

    before(async function (): void {
        this.timeout(40000);
        await GlobalConfig.initTestConfig();

        const res: $TSFixMe = await createUser(request, userData.user);
        const project: $TSFixMe = res.body.project;
        projectId = project._id;
        userId = res.body.id;

        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        const res1: $TSFixMe = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = res1.body.tokens.jwtAccessToken;
    });

    after(async (): void => {
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

    it('should create an email template with valid data', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should sanitize dirty template data sent to endpoint', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should get an array of email templates by valid projectId', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/emailTemplate/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    it('should get an email template by valid emailTemplateId', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .get(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    it('should update an email template by valid emailTemplateId', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .put(`/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`)
            .set('Authorization', authorization)
            .send({
                subject: 'New Mail Subject',
            });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.subject).to.be.equal('New Mail Subject');
    });

    it('should update default email template', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
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

    it('should deleted an email template', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .delete(
                `/emailTemplate/${projectId}/emailTemplate/${emailTemplateId}`
            )
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body.deleted).to.be.equal(true);
    });
});
