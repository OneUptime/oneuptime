// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import data from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Disable Sign up test', function() {
    this.timeout(200000);
    let token: $TSFixMe = null;
    this.beforeAll(async function() {
        this.timeout(400000);
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await GlobalConfig.initTestConfig();
        await createUser(request, data.adminUser);
        const res = await request.post('/user/login').send({
            email: data.adminUser.email,
            password: data.adminUser.password,
        });
        token = res.body.tokens.jwtAccessToken;
        process.env.DISABLE_SIGNUP = 'true'; // this is in quotes because of helm chart and kubernetes.
    });

    this.afterAll(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await ProjectService.hardDeleteBy({});
        process.env.DISABLE_SIGNUP = undefined;
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not sign up the user when sign up is disabled', (done: $TSFixMe) => {
        createUser(request, data.user, function(err: $TSFixMe, res: $TSFixMe) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('Sign up is disabled.');
            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should sign up a new user when user is admin', (done: $TSFixMe) => {
        const authorization = `Basic ${token}`;
        request
            .post('/user/signup')
            .set('Authorization', authorization)
            .send({
                ...data.anotherUser,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('email');
                expect(res.body).to.have.property('role');
                expect(res.body.role).to.equal('user');
                done();
            });
    });
});
