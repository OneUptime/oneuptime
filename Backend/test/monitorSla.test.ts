process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
const expect: $TSFixMe = chai.expect;
import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request: $TSFixMe = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import MonitorSlaService from '../backend/services/monitorSlaService';

const monitorSlaPayload: $TSFixMe = {
    name: 'fxPro',
    frequency: '30',
    monitorUptime: '99.95',
    isDefault: true,
};

describe('Monitor SLA', function (): void {
    const timeout: $TSFixMe = 30000;
    let projectId: ObjectID,
        userId,
        token,
        authorization: $TSFixMe,
        slaId: $TSFixMe;

    this.timeout(timeout);

    before(async (): void => {
        await GlobalConfig.initTestConfig();
        const res: $TSFixMe = await createUser(request, userData.user);
        projectId = res.body.project._id;
        userId = res.body.id;
        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const loginResponse: $TSFixMe = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = loginResponse.body.tokens.jwtAccessToken;
        authorization = `Basic ${token}`;
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await MonitorSlaService.hardDelete({
            _id: slaId,
        });
    });

    it('should not create a monitor SLA if the name is missing', async (): void => {
        const res: $TSFixMe = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                name: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('SLA name is required');
    });

    it('should not create monitor SLA if monitor uptime is missing', async (): void => {
        const res: $TSFixMe = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Monitor uptime is required');
    });

    it('should not create monitor SLA if monitor uptime is not numeric value', async (): void => {
        const res: $TSFixMe = await request
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

    it('should not create monitor SLA if frequency is not a numeric value', async (): void => {
        const res: $TSFixMe = await request
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

    it('should not create monitor SLA if frequency is less than a day', async (): void => {
        const res: $TSFixMe = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                frequency: '0',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('At lease a single day is needed');
    });

    it('should not create monitor SLA if monitor uptime is zero', async (): void => {
        const res: $TSFixMe = await request
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

    it('should not create monitor SLA if monitor uptime is greater than 100', async (): void => {
        const res: $TSFixMe = await request
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

    it('should create a monitor SLA', async (): void => {
        const res: $TSFixMe = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        slaId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(monitorSlaPayload.name);
    });

    it('should not create a monitor SLA with an existing name', async (): void => {
        const res: $TSFixMe = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Monitor SLA with the same name already exist'
        );
    });

    it('should not update a monitor SLA if the name is missing', async (): void => {
        const res: $TSFixMe = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                name: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('SLA name is required');
    });

    it('should not update monitor SLA if monitor uptime is missing', async (): void => {
        const res: $TSFixMe = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                monitorUptime: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Monitor uptime is required');
    });

    it('should not update monitor SLA if monitor uptime is not numeric value', async (): void => {
        const res: $TSFixMe = await request
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

    it('should not update monitor SLA if frequency is not a numeric value', async (): void => {
        const res: $TSFixMe = await request
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

    it('should not update monitor SLA if frequency is less than a day', async (): void => {
        const res: $TSFixMe = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...monitorSlaPayload,
                frequency: '0',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('At lease a single day is needed');
    });

    it('should not update monitor SLA if monitor uptime is zero', async (): void => {
        const res: $TSFixMe = await request
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

    it('should not update monitor SLA if monitor uptime is greater than 100', async (): void => {
        const res: $TSFixMe = await request
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

    it('should update a monitor SLA', async (): void => {
        monitorSlaPayload.frequency = '10';
        monitorSlaPayload.name = 'updatedFxPro';

        const res: $TSFixMe = await request
            .put(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(monitorSlaPayload.name);
        expect(res.body.frequency).to.be.equal(monitorSlaPayload.frequency);
    });

    it('should get the list of monitor SLAs', async (): void => {
        const res: $TSFixMe = await request
            .get(`/monitorSla/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body.count).to.be.equal(1);
        expect(res.body.limit).to.be.equal(10);
    });

    it('should delete a particular monitor SLA', async (): void => {
        const res: $TSFixMe = await request
            .delete(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body._id).to.be.equal(slaId);
    });
});
