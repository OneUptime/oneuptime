/* eslint-disable no-undef */

process.env.PORT = 3020;
process.env.IS_SAAS_SERVICE = true;
const chai = require('chai');
const expect = require('chai').expect;
const userData = require('./data/user');
const app = require('../server');
chai.use(require('chai-http'));
const request = chai.request.agent(app);
const GlobalConfig = require('./utils/globalConfig');
const { createUser } = require('./utils/userSignUp');
const VerificationTokenModel = require('../backend/models/verificationToken');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const MonitorSlaService = require('../backend/services/monitorSlaService');

const monitorSlaPayload = {
    name: 'fxPro',
    frequency: '30',
    monitorUptime: '99.95',
    isDefault: true,
};

describe('Monitor SLA', function() {
    const timeout = 30000;
    let projectId, userId, token, authorization, slaId;

    this.timeout(timeout);
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

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email,
        });
        await MonitorSlaService.hardDelete({
            _id: slaId,
        });
    });

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

    it('should create a monitor SLA', async function() {
        const res = await request
            .post(`/monitorSla/${projectId}`)
            .set('Authorization', authorization)
            .send(monitorSlaPayload);

        slaId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(monitorSlaPayload.name);
    });

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

    it('should get the list of monitor SLAs', async function() {
        const res = await request
            .get(`/monitorSla/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body.count).to.be.equal(1);
        expect(res.body.limit).to.be.equal(10);
    });

    it('should delete a particular monitor SLA', async function() {
        const res = await request
            .delete(`/monitorSla/${projectId}/${slaId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body._id).to.be.equal(slaId);
    });
});
