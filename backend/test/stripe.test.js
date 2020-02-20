process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');

let token, projectId, userId, airtableId;
const VerificationTokenModel = require('../backend/models/verificationToken');
const payment = require('../backend/config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const ngrok = require('ngrok');

let cardId, authorization, webhookId;

const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));


describe('Stripe payment API', function () {
    this.timeout(50000);

    before(function (done) {
        this.timeout(40000);
        createUser(request, userData.user, function(err, res) {
            const project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        authorization = `Basic ${token}`;
                        done();
                    });
                });
            });
        });
    });


    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await ngrok.disconnect();
        await stripe.webhookEndpoints.del(webhookId);
        await AirtableService.deleteUser(airtableId);
    });

    it('should sign up and a transaction of 1 $ should be made', function (done) {
        request.get(`/stripe/${projectId}/charges`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.length.greaterThan(0);
            expect(res.body.data[0]).to.be.an('object');
            expect(res.body.data[0]).to.have.property('failure_code');
            expect(res.body.data[0].failure_code).to.be.equal(null);
            expect(res.body.data[0]).to.have.property('amount');
            expect(res.body.data[0].amount).to.be.equal(100);
            done();
        });
    });

    it('should return payment intent when valid details are passed ', function (done) {
        request.post(`/stripe/${projectId}/creditCard/${'tok_amex'}/pi`).set('Authorization', authorization).end(function (err, res) {
            cardId = res.body.source;
            expect(res).to.have.status(200);
            expect(res.body).to.have.property('id');
            expect(res.body).to.have.property('client_secret');
            expect(res.body.client_secret).not.to.be.null;
            expect(res.body).to.have.property('source');
            expect(res.body.source).not.to.be.null;
            done();
        });
    });

    it('should return 2 cards attached to customer', function (done) {
        request.get(`/stripe/${projectId}/creditCard`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.length(2);
            done();
        });
    });
    it('should update default card for customer', function (done) {
        request.put(`/stripe/${projectId}/creditCard/${cardId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('default_source');
            expect(res.body.default_source).to.be.equal(cardId);
            done();
        });
    });
    it('should return 2 cards attached to customer', function (done) {
        request.get(`/stripe/${projectId}/creditCard`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.have.property('data');
            expect(res.body.data).to.be.an('array');
            expect(res.body.data).to.have.length(2);
            done();
        });
    });

    it('should fetch a single card', function (done) {
        request.get(`/stripe/${projectId}/creditCard/${cardId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('id');
            expect(res.body.id).not.to.be.null;
            expect(res.body).to.have.property('customer');
            expect(res.body.customer).not.to.be.null;
            done();
        });
    });

    it('should delete a card', function (done) {
        request.delete(`/stripe/${projectId}/creditCard/${cardId}`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            expect(res.body).to.have.property('id');
            expect(res.body.id).not.to.be.null;
            done();
        });
    });

    it('should not delete a single left card', function (done) {
        request.get(`/stripe/${projectId}/creditCard`).set('Authorization', authorization).end(function (err, res) {
            cardId = res.body.data[0].id;
            request.delete(`/stripe/${projectId}/creditCard/${cardId}`).set('Authorization', authorization).end(function (err, res) {
                expect(res).to.have.status(403);
                expect(res.body.message).to.be.equal('Cannot delete the only card');
                done();
            });
        });
    });

    it('should not create a payment intent when token(generated from client) is invalid', function (done) {
        request.post(`/stripe/${projectId}/creditCard/${'tok_invalid'}/pi`).set('Authorization', authorization).end(function (err, res) {
            expect(res).to.have.status(400);
            expect(res.body.message).to.be.equal('No such token: tok_invalid');
            done();
        });
    });
    it('should not add balance to customer accounts if rechargeBalanceAmount is not a valid integer', function (done) {
        request.post(`/stripe/${projectId}/addBalance`)
            .set('Authorization', authorization)
            .send({
                rechargeBalanceAmount: '43_'
            })
            .end(function (err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Amount should be present and it should be a valid number.');
                done();
            });
    });
    it('should return payment intent if rechargeBalanceAmount is a valid integer', function (done) {
        request.post(`/stripe/${projectId}/addBalance`)
            .set('Authorization', authorization)
            .send({
                rechargeBalanceAmount: '100'
            })
            .end(function (err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('id');
                expect(res.body).to.have.property('client_secret');
                expect(res.body.client_secret).not.to.be.null;
                expect(res.body).to.have.property('source');
                expect(res.body.source).not.to.be.null;
                done();
            });
    });
    it('should update balance when payment intent is confirmed from the client side', async function () {

        const ngrokURL = await ngrok.connect(3020);
        const url = `${ngrokURL}/stripe/webHook/pi`;
        const webhook = await stripe.webhookEndpoints.create({
            url,
            enabled_events: ['payment_intent.succeeded']
        });
        webhookId = webhook.id;
        if (webhook.status === 'enabled') {
            const addBalanceRequest = await request.post(`/stripe/${projectId}/addBalance`)
                .set('Authorization', authorization)
                .send({
                    rechargeBalanceAmount: '100'
                });
            const confirmedpaymentIntent = await stripe.paymentIntents.confirm(addBalanceRequest.body.id);
            if (confirmedpaymentIntent) {
                await sleep(20000);
                const project = await ProjectService.findOneBy({ _id: projectId });
                const { balance } = project;
                expect(balance).to.be.equal(100); 
            }
        }
    });
});