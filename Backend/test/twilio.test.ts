process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import incidentData from './data/incident';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import IncidentService from '../backend/services/incidentService';
import MonitorService from '../backend/services/monitorService';
import NotificationService from '../backend/services/notificationService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfigService from '../backend/services/globalConfigService';
import VerificationTokenModel from '../backend/models/verificationToken';

import { testphoneNumber } from './utils/config';
import GlobalConfig from './utils/globalConfig';

let token: $TSFixMe, userId, projectId: ObjectID, monitorId: $TSFixMe;
const monitor: $TSFixMe = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Twilio API', function (): void {
    this.timeout(20000);

    before(async function (): void {
        this.timeout(40000);
        await GlobalConfig.initTestConfig();
        let res = await createUser(request, userData.user);
        expect(res).to.have.status(200);
        projectId = res.body.project._id;
        userId = res.body.id;

        // make created user master admin
        await UserService.updateBy(
            { email: userData.user.email },
            { role: 'master-admin' }
        );

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        res = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        expect(res).to.have.status(200);
        token = res.body.tokens.jwtAccessToken;
        const authorization: string = `Basic ${token}`;
        res = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        expect(res).to.have.status(200);
        monitorId = res.body._id;
        incidentData.monitors = [monitorId];
        res = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should send verification sms code for adding alert phone number', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res = await request
            .post(`/twilio/sms/sendVerificationToken?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                to: testphoneNumber,
            });
        expect(res).to.have.status(200);
    });

    it('should send test sms to the provided phone number', async (): void => {
        const authorization: string = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value',
        });
        const value = configuration.value;
        const payload: $TSFixMe = {
            accountSid: value['account-sid'],
            authToken: value['authentication-token'],
            phoneNumber: value.phone,
            testphoneNumber,
        };

        const res = await request
            .post('/twilio/sms/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('message');
    });

    it('should return status code 400 when any of the payload field is missing', async (): void => {
        const authorization: string = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value',
        });
        const value = configuration.value;

        const payload: $TSFixMe = {
            accountSid: value['account-sid'],
            authToken: value['authentication-token'],
            phoneNumber: '',
        };

        const res = await request
            .post('/twilio/sms/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });

    it('should return status code 400 when accountSid is invalid', async (): void => {
        const authorization: string = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value name',
        });
        const value = configuration.value;

        value['account-sid'] = 'xxuerandomsid';
        const payload: $TSFixMe = {
            accountSid: value['account-sid'],
            authToken: value['authentication-token'],
            phoneNumber: value.phone,
            testphoneNumber,
        };

        const res = await request
            .post('/twilio/sms/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });

    it('should return status code 400 when authToken is invalid', async (): void => {
        const authorization: string = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value name',
        });
        const value = configuration.value;

        value['authentication-token'] = 'xxuerandomsid';
        const payload: $TSFixMe = {
            accountSid: value['account-sid'],
            authToken: value['authentication-token'],
            phoneNumber: value.phone,
            testphoneNumber,
        };

        const res = await request
            .post('/twilio/sms/test')
            .set('Authorization', authorization)
            .send(payload);
        expect(res).to.have.status(400);
    });
});
