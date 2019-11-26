
process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var UserService = require('../backend/services/userService');
var VerificationTokenModel = require('../backend/models/verificationToken');
var ProjectService = require('../backend/services/projectService');
var AirtableService = require('../backend/services/airtableService');

var payment = require('../backend/config/payment');
var stripe = require('stripe')(payment.paymentPrivateKey);

var token, userId, airtableId, projectId, stripeCustomerId, testPlan;

describe('Invoice API', function () {
    this.timeout(20000);

    before(async function () {
        this.timeout(30000);
        var checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: userData.email,
            companyName: userData.companyName
        });
        var confirmedPaymentIntent = await stripe.paymentIntents.confirm(checkCardData.body.id);

        var signUp = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id
            },
            ...userData.user
        });


        let project = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;
        airtableId = signUp.body.airtableId;

        var verificationToken = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${verificationToken.token}`).redirects(0);
        } catch (error) {
            //catch
        }

        var login = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        });
        token = login.body.tokens.jwtAccessToken;

        var user = await UserService.findOneBy({ _id: userId });
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
        var authorization = `Basic ${token}`;
        var invoices = await request.post(`/invoice/${projectId}`).set('Authorization', authorization);
        expect(invoices.status).to.be.equal(200);
        expect(invoices.body).to.be.an('object');
        expect(invoices.body).to.have.property('data');
        expect(invoices.body.data).to.be.an('object');
        expect(invoices.body.data).to.have.property('data');
        expect(invoices.body.data.data).to.be.an('array');
        expect(invoices.body.data.data).to.have.length(5);
        expect(invoices.body).to.have.property('count');
        expect(invoices.body.count).to.be.an('number').to.be.equal(5);
        expect(invoices.body.data.data[0].total).to.be.equal(5000);
    });
});