// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
// @ts-expect-error ts-migrate(2322) FIXME: Type 'true' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.IS_SAAS_SERVICE = true;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import UserService from '../backend/services/userService'
import VerificationTokenModel from '../backend/models/verificationToken'
import ProjectService from '../backend/services/projectService'
import AirtableService from '../backend/services/airtableService'
import GlobalConfig from './utils/globalConfig'
import payment from '../backend/config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey

// @ts-expect-error ts-migrate(7034) FIXME: Variable 'token' implicitly has type 'any' in some... Remove this comment to see the full error message
let token, userId, projectId, stripeCustomerId, testPlan;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Invoice API', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(200000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
        const checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{ randomU... Remove this comment to see the full error message
            email: userData.email,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type '{ r... Remove this comment to see the full error message
            companyName: userData.companyName,
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntents' does not exist on type '... Remove this comment to see the full error message
        const confirmedPaymentIntent = await stripe.paymentIntents.confirm(
            checkCardData.body.id
        );

        const signUp = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id,
            },
            ...userData.user,
        });

        const project = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;

        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        try {
            await request
                .get(`/user/confirmation/${verificationToken.token}`)
                .redirects(0);
        } catch (error) {
            //catch
        }

        const login = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = login.body.tokens.jwtAccessToken;

        const user = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        stripeCustomerId = user.stripeCustomerId;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'plans' does not exist on type 'typeof St... Remove this comment to see the full error message
        testPlan = await stripe.plans.create({
            amount: 5000,
            interval: 'month',
            product: {
                name: 'Test plan',
                type: 'service',
            },
            currency: 'usd',
        });

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        await stripe.subscriptions.create({
            customer: stripeCustomerId,
            items: [
                {
                    quantity: 1,
                    plan: testPlan.id,
                },
            ],
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
        await ProjectService.hardDeleteBy({ _id: projectId });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'plans' does not exist on type 'typeof St... Remove this comment to see the full error message
        await stripe.plans.del(testPlan.id);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'products' does not exist on type 'typeof... Remove this comment to see the full error message
        await stripe.products.del(testPlan.product);
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return invoices', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const invoices = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'userId' implicitly has an 'any' type.
            .post(`/invoice/${userId}`)
            .set('Authorization', authorization);
        expect(invoices.status).to.be.equal(200);
        expect(invoices.body).to.be.an('object');
        expect(invoices.body).to.have.property('data');
        expect(invoices.body.data).to.be.an('object');
        expect(invoices.body.data).to.have.property('data');
        expect(invoices.body.data.data).to.be.an('array');
        expect(invoices.body.data.data).to.have.length(3);
        expect(invoices.body).to.have.property('count');
        expect(invoices.body.count)
            .to.be.an('number')
            .to.be.equal(3);
        expect(invoices.body).not.to.have.property('total_count');
        expect(invoices.body.data.data[0].total).to.be.equal(5000);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should paginate invoices', async function() {
        for (let i = 0; i < 10; i++) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
            await stripe.subscriptions.create({
                // @ts-expect-error ts-migrate(7005) FIXME: Variable 'stripeCustomerId' implicitly has an 'any... Remove this comment to see the full error message
                customer: stripeCustomerId,
                items: [
                    {
                        quantity: 1,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'testPlan' implicitly has an 'any' type.
                        plan: testPlan.id,
                    },
                ],
            });
        }

        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        let invoices = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'userId' implicitly has an 'any' type.
            .post(`/invoice/${userId}`)
            .set('Authorization', authorization);
        expect(invoices.status).to.be.equal(200);
        expect(invoices.body).to.be.an('object');
        expect(invoices.body).to.have.property('data');
        expect(invoices.body.data).to.be.an('object');
        expect(invoices.body.data).to.have.property('data');
        expect(invoices.body.data.data).to.be.an('array');
        expect(invoices.body.data.data).to.have.length(10);
        expect(invoices.body).to.have.property('count');
        expect(invoices.body.count)
            .to.be.an('number')
            .to.be.equal(10);
        expect(invoices.body.data).to.have.property('has_more');
        expect(invoices.body.data.has_more).to.be.equal(true);
        invoices = await request
            .post(
                // @ts-expect-error ts-migrate(7005) FIXME: Variable 'userId' implicitly has an 'any' type.
                `/invoice/${userId}?startingAfter=${invoices.body.data.data[9].id}`
            )
            .set('Authorization', authorization);
        expect(invoices.status).to.be.equal(200);
        expect(invoices.body).to.be.an('object');
        expect(invoices.body).to.have.property('data');
        expect(invoices.body.data).to.be.an('object');
        expect(invoices.body.data).to.have.property('data');
        expect(invoices.body.data.data).to.be.an('array');
        expect(invoices.body.data.data).to.have.length(3);
        expect(invoices.body).to.have.property('count');
        expect(invoices.body.count)
            .to.be.an('number')
            .to.be.equal(3);
        expect(invoices.body.data).to.have.property('has_more');
        expect(invoices.body.data.has_more).to.be.equal(false);
    });
});
