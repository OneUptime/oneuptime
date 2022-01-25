process.env.PORT = 3002;
process.env.IS_SAAS_SERVICE = true;
const expect = require('chai').expect;
const data = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const AirtableService = require('../backend/services/airtableService');
const payment = require('../backend/config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);

describe('Disable Sign up test', function() {
    this.timeout(200000);
    let token = null;
    this.beforeAll(async function() {
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

    this.afterAll(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        process.env.DISABLE_SIGNUP = undefined;
    });

    it('should not sign up the user when sign up is disabled', async () => {
        const res = await createUser(request, data.user);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Sign up is disabled.');
    });

    it('should sign up a new user when user is admin', async () => {
        const authorization = `Basic ${token}`;
        const res = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: data.anotherUser.email,
            companyName: data.anotherUser.companyName,
        });
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
