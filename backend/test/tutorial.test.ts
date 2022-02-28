// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
chai.use(require(..set'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import AirtableService from '../backend/services/airtableService'

import VerificationTokenModel from '../backend/models/verificationToken'

let projectId: $TSFixMe, userId: $TSFixMe, token: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Tutorial API', function() {
    this.timeout(80000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
        this.timeout(120000);
        await GlobalConfig.initTestConfig();
        const res = await createUser(request, userData.user);
        const project = res.body.project;
        projectId = project._id;
        userId = res.body.id;

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);

        const res1 = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = res1.body.tokens.jwtAccessToken;
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
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get the user tutorial status', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get('/tutorial')
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body._id).to.be.equal(userId);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not update the user tutorial status if project id is not given', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type: 'monitor',
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(`Project ID can't be null`);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update the user custom component tutorial status per project', async function() {
        const authorization = `Basic ${token}`;
        const type = 'component';
        const res = await request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type,
                projectId,
            });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data[projectId]).to.be.an('object');
        expect(res.body.data[projectId][type]).to.be.an('object');
        expect(res.body.data[projectId][type].show).to.be.equal(false);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update the user custom team memb er tutorial status per project', async function() {
        const authorization = `Basic ${token}`;
        const type = 'teamMember';
        const res = await request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type,
                projectId,
            });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data[projectId]).to.be.an('object');
        expect(res.body.data[projectId][type]).to.be.an('object');
        expect(res.body.data[projectId][type].show).to.be.equal(false);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get the user tutorial status for a project', async function() {
        const authorization = `Basic ${token}`;
        const res = await request
            .get('/tutorial')
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body._id).to.be.equal(userId);
        expect(res.body.data[projectId]).to.be.an('object');
        expect(res.body.data[projectId].component.show).to.be.equal(false);
        expect(res.body.data[projectId].teamMember.show).to.be.equal(false);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update the user status page tutorial status per project', async function() {
        const authorization = `Basic ${token}`;
        const type = 'statusPage';
        const res = await request
            .put('/tutorial')
            .set('Authorization', authorization)
            .send({
                type,
                projectId,
            });
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data[projectId]).to.be.an('object');
        expect(res.body.data[projectId][type]).to.be.an('object');
        expect(res.body.data[projectId][type].show).to.be.equal(false);
    });
});
