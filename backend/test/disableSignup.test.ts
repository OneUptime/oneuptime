// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
// @ts-expect-error ts-migrate(2322) FIXME: Type 'true' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.IS_SAAS_SERVICE = true;
const expect = require('chai').expect;
import data from './data/user'
import chai from ..
chai.use(require('chai-http'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import AirtableService from '../backend/services/airtableService'
import payment from '../backend/config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Disable Sign up test', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(200000);
    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'token' implicitly has type 'any' in some... Remove this comment to see the full error message
    let token = null;
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.beforeAll(async function() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(400000);
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.initTestConfig();
        const user = await createUser(request, data.adminUser);
        await UserService.updateBy(
            { _id: user.body.id },
            { role: 'master-admin' }
        );
        const res = await request.post('/user/login').send({
            email: data.adminUser.email,
            password: data.adminUser.password,
        });
        token = res.body.tokens.jwtAccessToken;
        process.env.DISABLE_SIGNUP = 'true'; // this is in quotes because of helm chart and kubernetes.
    });

    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.afterAll(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        process.env.DISABLE_SIGNUP = undefined;
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not sign up the user when sign up is disabled', async () => {
        const res = await createUser(request, data.user);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Sign up is disabled.');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should sign up a new user when user is admin', async () => {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: data.anotherUser.email,
            companyName: data.anotherUser.companyName,
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntents' does not exist on type '... Remove this comment to see the full error message
        const paymentIntent = await stripe.paymentIntents.confirm(res.body.id);
        expect(paymentIntent).to.have.status('succeeded');

        const res2 = await request
            .post('/user/signup')
            .set('Authorization', authorization)
            .send({
                paymentIntent: {
                    id: paymentIntent.id,
                },
                ...data.anotherUser,
            });
        expect(res2).to.have.status(200);
        expect(res2.body).to.have.property('email');
        expect(res2.body).to.have.property('role');
        expect(res2.body.role).to.equal('user');
    });
});
