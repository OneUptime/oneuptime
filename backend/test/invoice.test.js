
process.env.PORT = 3020;
let expect = require('chai').expect;
let userData = require('./data/user');
let chai = require('chai');
chai.use(require('chai-http'));
let app = require('../server');

let request = chai.request.agent(app);
let UserService = require('../backend/services/userService');
let VerificationTokenModel = require('../backend/models/verificationToken');
let ProjectService = require('../backend/services/projectService');
let AirtableService = require('../backend/services/airtableService');

let payment = require('../backend/config/payment');
let stripe = require('stripe')(payment.paymentPrivateKey);

let token, userId, airtableId, projectId, stripeCustomerId, testPlan;

describe('Invoice API', function () {
    this.timeout(20000);

    before(async function () {
        this.timeout(30000);
        let checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: userData.email,
            companyName: userData.companyName
        });
        let confirmedPaymentIntent = await stripe.paymentIntents.confirm(checkCardData.body.id);

        let signUp = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id
            },
            ...userData.user
        });


        let project = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;
        airtableId = signUp.body.airtableId;

        let verificationToken = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch (error) {
            //catch
        }

        let login = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });
        token = login.body.tokens.jwtAccessToken;

        let user = await UserService.findOneBy({ _id: userId });
        stripeCustomerId = user.stripeCustomerId;

        testPlan = await stripe.plans.create({
            amount: 5000,
            interval: 'month',
            product: {
                name: 'Test plan',
                type: 'service'
            },
            currency: 'usd',
        });

        await stripe.subscriptions.create({
            customer: stripeCustomerId,
            items: [{
                quantity: 1,
                plan: testPlan.id
            }]
        });
    });

    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await stripe.plans.del(testPlan.id);
        await stripe.products.del(testPlan.product);
        await AirtableService.deleteUser(airtableId);
    });

    it('should return invoices', async function () {
        let authorization = `Basic ${token}`;
        let invoices = await request.post(`/invoice/${projectId}`).set('Authorization', authorization);
        expect(invoices.status).to.be.equal(200);
        expect(invoices.body).to.be.an('object');
        expect(invoices.body).to.have.property('data');
        expect(invoices.body.data).to.be.an('object');
        expect(invoices.body.data).to.have.property('data');
        expect(invoices.body.data.data).to.be.an('array');
        expect(invoices.body.data.data).to.have.length(3);
        expect(invoices.body).to.have.property('count');
        expect(invoices.body.count).to.be.an('number').to.be.equal(3);
        expect(invoices.body.data.data[0].total).to.be.equal(5000);
    });
});