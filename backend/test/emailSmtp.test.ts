// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import data from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chai-http);
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import AirtableService from '../backend/services/airtableService'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/config"' has no exported member '... Remove this comment to see the full error message
import { testemail } from './utils/config'
import GlobalConfigService from '../backend/services/globalConfigService'
import VerificationTokenModel from '../backend/models/verificationToken'
import smtpCredential from './data/smtpCredential'

let projectId: $TSFixMe, jwtToken: $TSFixMe, emailSmtpId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Email SMTP Api Test', function(this: $TSFixMe) {
    this.timeout(200000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function(this: $TSFixMe) {
        this.timeout(400000);
        await GlobalConfig.initTestConfig();
        const res = await createUser(request, data.user);

        const project = res.body.project;
        projectId = project._id;
        const userId = res.body.id;

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        await UserService.updateBy({ _id: userId }, { role: 'master-admin' });

        const res1 = await request.post('/user/login').send({
            email: data.user.email,
            password: data.user.password,
        });
        jwtToken = res1.body.tokens.jwtAccessToken;
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should confirm that `master-admin` exists', async () => {
        const res = await request.get('/user/masterAdminExists');
        expect(res).to.have.status(200);
        expect(res.body).have.property('result');
        expect(res.body.result).to.eql(true);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should send test smtp email to the provided email address', async () => {
        const authorization = `Basic ${jwtToken}`;
        const { value } = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value name',
        });
        const payload = {
            user: value.email,
            pass: value.password,
            host: value['smtp-server'],
            port: value['smtp-port'],
            from: value['from'],
            name: value['from-name'],
            secure: value['smtp-secure'],
            email: testemail,
        };

        const res = await request
            .post('/emailSmtp/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not send test smtp email when user or pass is not valid', async () => {
        const authorization = `Basic ${jwtToken}`;
        const { value } = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value name',
        });

        value.email = 'randomemail@gmail.com';
        const payload = {
            user: value.email,
            pass: value.password,
            host: value['smtp-server'],
            port: value['smtp-port'],
            name: value['from-name'],
            from: value['from'],
            secure: value['smtp-secure'],
            email: testemail,
        };
        const res = await request
            .post('/emailSmtp/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not send test smtp email when host or port is invalid', async () => {
        const authorization = `Basic ${jwtToken}`;
        const { value } = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value',
        });

        value['smtp-server'] = 'random.host';
        const payload = {
            user: value.email,
            pass: value.password,
            host: value['smtp-server'],
            port: value['smtp-port'],
            name: value['from-name'],
            from: value['from'],
            secure: value['smtp-secure'],
            email: testemail,
        };

        const res = await request
            .post('/emailSmtp/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should save custom SMTP settings', async () => {
        const authorization = `Basic ${jwtToken}`;
        const data = {
            ...smtpCredential,
        };

        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);

        emailSmtpId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.user).to.be.equal(data.user);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not save custom SMTP settings if user name is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let user;
        const data = {
            ...smtpCredential,
            user,
        };

        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('User Name is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not save custom SMTP settings if password is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let pass;
        const data = {
            ...smtpCredential,
            pass,
        };

        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Password is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not save custom SMTP settings if host is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let host;
        const data = {
            ...smtpCredential,
            host,
        };

        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('host is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not save custom SMTP settings if port is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let port;
        const data = {
            ...smtpCredential,
            port,
        };
        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('port is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not save custom SMTP settings if from is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let from;
        const data = {
            ...smtpCredential,
            from,
        };
        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('from is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not save custom SMTP settings if name is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let name;
        const data = {
            ...smtpCredential,
            name,
        };
        const res = await request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('name is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update a custom SMTP settings', async () => {
        const authorization = `Basic ${jwtToken}`;
        const data = { ...smtpCredential, from: 'info@gmail.com' };
        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(200);
        expect(res.body.from).to.be.equal(data.from);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update custom SMTP settings if user name is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let user;
        const data = {
            ...smtpCredential,
            user,
        };
        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('User Name is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update custom SMTP settings if password is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let pass;
        const data = {
            ...smtpCredential,
            pass,
        };

        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Password is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update custom SMTP settings if host is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let host;
        const data = {
            ...smtpCredential,
            host,
        };

        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('host is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update custom SMTP settings if port is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let port;
        const data = {
            ...smtpCredential,
            port,
        };

        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('port is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update custom SMTP settings if from is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let from;
        const data = {
            ...smtpCredential,
            from,
        };
        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('from is required.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update custom SMTP settings if name is missing', async () => {
        const authorization = `Basic ${jwtToken}`;
        let name;
        const data = {
            ...smtpCredential,
            name,
        };
        const res = await request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('name is required.');
    });
});
