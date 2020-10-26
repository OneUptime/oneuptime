/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const incidentData = require('./data/incident');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const IncidentService = require('../backend/services/incidentService');
const MonitorService = require('../backend/services/monitorService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');
const GlobalConfigService = require('../backend/services/globalConfigService');
const VerificationTokenModel = require('../backend/models/verificationToken');
const { testphoneNumber } = require('./utils/config');
const GlobalConfig = require('./utils/globalConfig');

let token, userId, projectId, monitorId;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Twilio API', function() {
    this.timeout(20000);

    before(async function() {
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
        const authorization = `Basic ${token}`;
        res = await request
            .post(`/monitor/${projectId}`)
            .set('Authorization', authorization)
            .send(monitor);
        expect(res).to.have.status(200);
        monitorId = res.body._id;
        res = await request
            .post(`/incident/${projectId}/${monitorId}`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    after(async function() {
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

    it('should send verification sms code for adding alert phone number', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .post(`/twilio/sms/sendVerificationToken?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                to: testphoneNumber,
            });
        expect(res).to.have.status(200);
    });

    it('should send test sms to the provided phone number', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        const value = configuration.value;
        const payload = {
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

    it('should return status code 400 when any of the payload field is missing', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        const value = configuration.value;

        const payload = {
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

    it('should return status code 400 when accountSid is invalid', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        const value = configuration.value;

        value['account-sid'] = 'xxuerandomsid';
        const payload = {
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

    it('should return status code 400 when authToken is invalid', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        const value = configuration.value;

        value['authentication-token'] = 'xxuerandomsid';
        const payload = {
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
