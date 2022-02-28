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
import IncidentCommunicationSlaService from '../backend/services/incidentCommunicationSlaService'

const incidentSlaPayload = {
    name: 'fxPro',
    alertTime: '2',
    duration: '5',
    isDefault: true,
};
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incident Communication SLA', function() {
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
        await IncidentCommunicationSlaService.hardDelete({
            _id: slaId,
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add incident communication SLA without a name', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add incident communication SLA without an alertTime', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add incident communication SLA when duration is not a number', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add incident communication SLA when alertTime is not a number', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add incident communication SLA when alertTime is greater than or equal to duration', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add incident communication SLA', async function() {
        const res = await request
            .post(`/incidentSla/${projectId}`)
            .set('Authorization', authorization)
            .send(incidentSlaPayload);
        slaId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(incidentSlaPayload.name);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update an incident communication SLA', async function() {
        incidentSlaPayload.name = 'NewName';
        const res = await request
            .put(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization)
            .send(incidentSlaPayload);

        expect(res).to.have.status(200);
        expect(res.body.name).to.be.equal(incidentSlaPayload.name);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update incident communication SLA without a name', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update incident communication SLA without an alertTime', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update incident communication SLA when duration is not a number', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update incident communication SLA when alertTime is not a number', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update incident communication SLA when alertTime is greater than or equal to duration', async function() {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should fetch all the incident communication SLAs', async function() {
        const res = await request
            .get(`/incidentSla/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(res.body.count).to.be.equal(1);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete an incident communication SLA', async function() {
        const res = await request
            .delete(`/incidentSla/${projectId}/${slaId}`)
            .set('Authorization', authorization);

        expect(res).to.have.status(200);
        expect(String(res.body._id)).to.be.equal(String(slaId));
    });
});
