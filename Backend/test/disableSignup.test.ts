process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import { expect } from 'chai';
import data from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import AirtableService from '../backend/services/airtableService';
import payment from '../backend/config/payment';
import Stripe from 'stripe';
const stripe: $TSFixMe = Stripe(payment.paymentPrivateKey);

describe('Disable Sign up test', function (): void {
    this.timeout(200000);

    let token = null;

    this.beforeAll(async function (): void {
        this.timeout(400000);
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.initTestConfig();
        const user: $TSFixMe = await createUser(request, data.adminUser);
        await UserService.updateBy(
            { _id: user.body.id },
            { role: 'master-admin' }
        );
        const res: $TSFixMe = await request.post('/user/login').send({
            email: data.adminUser.email,
            password: data.adminUser.password,
        });
        token = res.body.tokens.jwtAccessToken;
        process.env['DISABLE_SIGNUP'] = 'true'; // this is in quotes because of helm chart and kubernetes.
    });

    this.afterAll(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        process.env['DISABLE_SIGNUP'] = undefined;
    });

    it('should not sign up the user when sign up is disabled', async () => {
        const res: $TSFixMe = await createUser(request, data.user);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Sign up is disabled.');
    });

    it('should sign up a new user when user is admin', async () => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: data.anotherUser.email,
            companyName: data.anotherUser.companyName,
        });

        const paymentIntent: $TSFixMe = await stripe.paymentIntents.confirm(
            res.body.id
        );
        expect(paymentIntent).to.have.status('succeeded');

        const res2: $TSFixMe = await request
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
