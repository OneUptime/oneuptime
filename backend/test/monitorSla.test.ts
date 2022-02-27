// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
// @ts-expect-error ts-migrate(2322) FIXME: Type 'true' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.IS_SAAS_SERVICE = true;
import chai from 'chai'
const expect = re..ai').expect;
import userData from './data/user'
import app from '../server'
chai.use(require('chai-http'));
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import VerificationTokenModel from '../backend/models/verificationToken'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import MonitorSlaService from '../backend/services/monitorSlaService'

const monitorSlaPayload = {
    name: 'fxPro',
    frequency: '30',
    monitorUptime: '99.95',
    isDefault: true,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Monitor SLA', function(this: $TSFixMe) {
    const timeout = 30000;
    let projectId: $TSFixMe, userId, token, authorization: $TSFixMe, slaId: $TSFixMe;

    this.timeout(timeout);
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
        await GlobalConfig.initTestConfig();
        const res = await createUser(request, userData.user);
        projectId = res.body.project._id;
        userId = res.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const loginResponse = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = loginResponse.body.tokens.jwtAccessToken;
        authorization = `Basic ${token}`;
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await MonitorSlaService.hardDelete({
            _id: slaId,
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a monitor SLA if the name is missing', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                name: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('SLA name is required');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create monitor SLA if monitor uptime is missing', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Monitor uptime is required');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create monitor SLA if monitor uptime is not numeric value', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '99.9e',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for monitor uptime'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create monitor SLA if frequency is not a numeric value', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                frequency: '30days',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for frequency'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create monitor SLA if frequency is less than a day', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                frequency: '0',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('At lease a single day is needed');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create monitor SLA if monitor uptime is zero', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '0',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Monitor Uptime less than 1 is not allowed'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create monitor SLA if monitor uptime is greater than 100', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '150',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Monitor Uptime greater than 100 is not allowed'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a monitor SLA', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        slaId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(monitorSlaPayload.name);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a monitor SLA with an existing name', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Monitor SLA with the same name already exist'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update a monitor SLA if the name is missing', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                name: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('SLA name is required');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update monitor SLA if monitor uptime is missing', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Monitor uptime is required');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update monitor SLA if monitor uptime is not numeric value', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '99.9e',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for monitor uptime'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update monitor SLA if frequency is not a numeric value', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                frequency: '30days',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for frequency'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update monitor SLA if frequency is less than a day', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                frequency: '0',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('At lease a single day is needed');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update monitor SLA if monitor uptime is zero', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '0',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Monitor Uptime less than 1 is not allowed'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update monitor SLA if monitor uptime is greater than 100', async function() {
        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '150',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Monitor Uptime greater than 100 is not allowed'
        );
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update a monitor SLA', async function() {
        monitorSlaPayload.frequency = '10';
        monitorSlaPayload.name = 'updatedFxPro';

        const res = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(monitorSlaPayload.name);
        expect(res.body.frequency).to.be.equal(monitorSlaPayload.frequency);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get the list of monitor SLAs', async function() {
        const res = await request
            .get(`/monitorSla/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body.count).to.be.equal(1);
        expect(res.body.limit).to.be.equal(10);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a particular monitor SLA', async function() {
        const res = await request
            .delete(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body._id).to.be.equal(slaId);
    });
});
