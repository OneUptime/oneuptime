process.env['PORT'] = 3020;
import { expect } from 'chai';
import data from './data/user';
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
import AirtableService from '../backend/services/airtableService';

import { testemail } from './utils/config';
import GlobalConfigService from '../backend/services/globalConfigService';
import VerificationTokenModel from '../backend/models/verificationToken';
import smtpCredential from './data/smtpCredential';

let projectId: ObjectID, jwtToken: $TSFixMe, emailSmtpId: $TSFixMe;

describe('Email SMTP Api Test', function (): void {
    this.timeout(200000);

    before(async function (): void {
        this.timeout(400000);
        await GlobalConfig.initTestConfig();
        const res: $TSFixMe = await createUser(request, data.user);

        const project: $TSFixMe = res.body.project;
        projectId = project._id;
        const userId: $TSFixMe = res.body.id;

        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        await UserService.updateBy({ _id: userId }, { role: 'master-admin' });

        const res1: $TSFixMe = await request.post('/user/login').send({
            email: data.user.email,
            password: data.user.password,
        });
        jwtToken = res1.body.tokens.jwtAccessToken;
    });

    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [data.user.email.toLowerCase()],
            },
        });
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId] },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should confirm that `master-admin` exists', async () => {
        const res: $TSFixMe = await request.get('/user/masterAdminExists');
        expect(res).to.have.status(200);
        expect(res.body).have.property('result');
        expect(res.body.result).to.eql(true);
    });

    it('should send test smtp email to the provided email address', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        const { value }: $TSFixMe = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value name',
        });
        const payload: $TSFixMe = {
            user: value.email,
            pass: value.password,
            host: value['smtp-server'],
            port: value['smtp-port'],
            from: value['from'],
            name: value['from-name'],
            secure: value['smtp-secure'],
            email: testemail,
        };

        const res: $TSFixMe = await request
            .post('/emailSmtp/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    it('should not send test smtp email when user or pass is not valid', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        const { value }: $TSFixMe = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value name',
        });

        value.email = 'randomemail@gmail.com';
        const payload: $TSFixMe = {
            user: value.email,
            pass: value.password,
            host: value['smtp-server'],
            port: value['smtp-port'],
            name: value['from-name'],
            from: value['from'],
            secure: value['smtp-secure'],
            email: testemail,
        };
        const res: $TSFixMe = await request
            .post('/emailSmtp/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });

    it('should not send test smtp email when host or port is invalid', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        const { value }: $TSFixMe = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value',
        });

        value['smtp-server'] = 'random.host';
        const payload: $TSFixMe = {
            user: value.email,
            pass: value.password,
            host: value['smtp-server'],
            port: value['smtp-port'],
            name: value['from-name'],
            from: value['from'],
            secure: value['smtp-secure'],
            email: testemail,
        };

        const res: $TSFixMe = await request
            .post('/emailSmtp/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });

    it('should save custom SMTP settings', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        const data: $TSFixMe = {
            ...smtpCredential,
        };

        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);

        emailSmtpId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.user).to.be.equal(data.user);
    });

    it('should not save custom SMTP settings if user name is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let user: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            user,
        };

        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('User Name is required.');
    });

    it('should not save custom SMTP settings if password is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let pass: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            pass,
        };

        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Password is required.');
    });

    it('should not save custom SMTP settings if host is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let host: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            host,
        };

        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('host is required.');
    });

    it('should not save custom SMTP settings if port is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let port: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            port,
        };
        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('port is required.');
    });

    it('should not save custom SMTP settings if from is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let from: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            from,
        };
        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('from is required.');
    });

    it('should not save custom SMTP settings if name is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let name: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            name,
        };
        const res: $TSFixMe = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('name is required.');
    });

    it('should update a custom SMTP settings', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        const data: $TSFixMe = { ...smtpCredential, from: 'info@gmail.com' };
        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(200);
        expect(res.body.from).to.be.equal(data.from);
    });

    it('should not update custom SMTP settings if user name is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let user: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            user,
        };
        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('User Name is required.');
    });

    it('should not update custom SMTP settings if password is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let pass: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            pass,
        };

        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Password is required.');
    });

    it('should not update custom SMTP settings if host is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let host: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            host,
        };

        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('host is required.');
    });

    it('should not update custom SMTP settings if port is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let port: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            port,
        };

        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('port is required.');
    });

    it('should not update custom SMTP settings if from is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let from: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            from,
        };
        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('from is required.');
    });

    it('should not update custom SMTP settings if name is missing', async () => {
        const authorization: string = `Basic ${jwtToken}`;
        let name: $TSFixMe;
        const data: $TSFixMe = {
            ...smtpCredential,
            name,
        };
        const res: $TSFixMe = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('name is required.');
    });
});
