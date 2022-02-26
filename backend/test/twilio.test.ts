// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import incidentData from './data/incident'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import IncidentService from '../backend/services/incidentService'
import MonitorService from '../backend/services/monitorService'
import NotificationService from '../backend/services/notificationService'
import AirtableService from '../backend/services/airtableService'
import GlobalConfigService from '../backend/services/globalConfigService'
import VerificationTokenModel from '../backend/models/verificationToken'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/config"' has no exported member '... Remove this comment to see the full error message
import { testphoneNumber } from './utils/config'
import GlobalConfig from './utils/globalConfig'

let token: $TSFixMe, userId, projectId: $TSFixMe, monitorId: $TSFixMe;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Twilio API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function(this: $TSFixMe) {
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
        incidentData.monitors = [monitorId];
        res = await request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should send test sms to the provided phone number', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value',
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return status code 400 when any of the payload field is missing', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value',
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return status code 400 when accountSid is invalid', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value name',
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return status code 400 when authToken is invalid', async function() {
        const authorization = `Basic ${token}`;
        const configuration = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value name',
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
