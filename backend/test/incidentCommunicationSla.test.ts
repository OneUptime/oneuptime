process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai from 'chai';
const expect = chai.expect;
import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import IncidentCommunicationSlaService from '../backend/services/incidentCommunicationSlaService';

const incidentSlaPayload = {
    name: 'fxPro',
    alertTime: '2',
    duration: '5',
    isDefault: true,
};

describe('Incident Communication SLA', function () {
    const timeout = 30000;
    let projectId: $TSFixMe,
        userId,
        token,
        authorization: $TSFixMe,
        slaId: $TSFixMe;

    this.timeout(timeout);

    before(async function () {
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

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await IncidentCommunicationSlaService.hardDelete({
            _id: slaId,
        });
    });

    it('should not add incident communication SLA without a name', async function () {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                name: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('SLA name is required');
    });

    it('should not add incident communication SLA without an alertTime', async function () {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                alertTime: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please set alert time for this SLA'
        );
    });

    it('should not add incident communication SLA when duration is not a number', async function () {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                duration: '10e',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for duration'
        );
    });

    it('should not add incident communication SLA when alertTime is not a number', async function () {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                alertTime: '10e',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for alert time'
        );
    });

    it('should not add incident communication SLA when alertTime is greater than or equal to duration', async function () {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                duration: '10',
                alertTime: '12',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Alert time should be always less than duration'
        );
    });

    it('should add incident communication SLA', async function () {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send(incidentSlaPayload);
        slaId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(incidentSlaPayload.name);
    });

    it('should update an incident communication SLA', async function () {
        incidentSlaPayload.name = 'NewName';
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send(incidentSlaPayload);

        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(incidentSlaPayload.name);
    });

    it('should not update incident communication SLA without a name', async function () {
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                name: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('SLA name is required');
    });

    it('should not update incident communication SLA without an alertTime', async function () {
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                alertTime: '',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please set alert time for this SLA'
        );
    });

    it('should not update incident communication SLA when duration is not a number', async function () {
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                duration: '10e',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for duration'
        );
    });

    it('should not update incident communication SLA when alertTime is not a number', async function () {
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                alertTime: '10e',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Please use numeric values for alert time'
        );
    });

    it('should not update incident communication SLA when alertTime is greater than or equal to duration', async function () {
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send({
                ...incidentSlaPayload,
                duration: '10',
                alertTime: '12',
            });

        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Alert time should be always less than duration'
        );
    });

    it('should fetch all the incident communication SLAs', async function () {
        const res = await request
            .get(`/incidentSla/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body.count).to.be.equal(1);
    });

    it('should delete an incident communication SLA', async function () {
        const res = await request
            .delete(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(String(res.body._id)).to.be.equal(String(slaId));
    });
});
