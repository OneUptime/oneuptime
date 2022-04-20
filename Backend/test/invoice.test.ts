process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai, { expect } from 'chai';
import userData from './data/user';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request: $TSFixMe = chai.request.agent(app);
import UserService from '../backend/services/userService';
import VerificationTokenModel from '../backend/models/verificationToken';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import payment from '../backend/config/payment';
import Stripe from 'stripe';
const stripe: $TSFixMe = Stripe(payment.paymentPrivateKey);

let token: $TSFixMe,
    userId: $TSFixMe,
    projectId: $TSFixMe,
    stripeCustomerId: $TSFixMe,
    testPlan: $TSFixMe;

describe('Invoice API', function (): void {
    this.timeout(200000);

    before(async function (): void {
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
        const checkCardData: $TSFixMe = await request
            .post('/stripe/checkCard')
            .send({
                tokenId: 'tok_visa',

                email: userData.email,

                companyName: userData.companyName,
            });

        const confirmedPaymentIntent: $TSFixMe =
            await stripe.paymentIntents.confirm(checkCardData.body.id);

        const signUp: $TSFixMe = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id,
            },
            ...userData.user,
        });

        const project: $TSFixMe = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;

        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        try {
            await request
                .get(`/user/confirmation/${verificationToken.token}`)
                .redirects(0);
        } catch (error) {
            //Catch
        }

        const login: $TSFixMe = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = login.body.tokens.jwtAccessToken;

        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        stripeCustomerId = user.stripeCustomerId;

        testPlan = await stripe.plans.create({
            amount: 5000,
            interval: 'month',
            product: {
                name: 'Test plan',
                type: 'service',
            },
            currency: 'usd',
        });

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

    after(async (): void => {
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

        await ProjectService.hardDeleteBy({ _id: projectId });

        await stripe.plans.del(testPlan.id);

        await stripe.products.del(testPlan.product);
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should return invoices', async (): void => {
        const authorization: string = `Basic ${token}`;
        const invoices: $TSFixMe = await request

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
        expect(invoices.body.count).to.be.an('number').to.be.equal(3);
        expect(invoices.body).not.to.have.property('total_count');
        expect(invoices.body.data.data[0].total).to.be.equal(5000);
    });

    it('should paginate invoices', async (): void => {
        for (let i: $TSFixMe = 0; i < 10; i++) {
            await stripe.subscriptions.create({
                customer: stripeCustomerId,
                items: [
                    {
                        quantity: 1,

                        plan: testPlan.id,
                    },
                ],
            });
        }

        const authorization: string = `Basic ${token}`;
        let invoices: $TSFixMe = await request

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
        expect(invoices.body.count).to.be.an('number').to.be.equal(10);
        expect(invoices.body.data).to.have.property('has_more');
        expect(invoices.body.data.has_more).to.be.equal(true);
        invoices = await request
            .post(
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
        expect(invoices.body.count).to.be.an('number').to.be.equal(3);
        expect(invoices.body.data).to.have.property('has_more');
        expect(invoices.body.data.has_more).to.be.equal(false);
    });
});
