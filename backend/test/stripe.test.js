process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var token, projectId, userId;
var VerificationTokenModel = require('../backend/models/verificationToken');
var payment = require('../backend/config/payment');
var stripe = require('stripe')(payment.paymentPrivateKey);

var cardId, authorization;

describe('Stripe payment API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
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
        await ProjectService.hardDeleteBy({_id: projectId});
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
        stripe.tokens.create({
            card: {
                number: '4242424242424242',
                exp_month: 12,
                exp_year: 2020,
                cvc: '123'
            }
        }, function (err, token){
            request.post(`/stripe/${projectId}/creditCard/${token.id}/pi`).set('Authorization', authorization).end(function (err, res) {
                cardId = token.card.id;
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('id');
                expect(res.body).to.have.property('client_secret');
                expect(res.body.client_secret).not.to.be.null;
                expect(res.body).to.have.property('source');
                expect(res.body.source).not.to.be.null;
                done();
            });
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
    it('should update default card for customer', function(done){
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
            expect(res.body).to.have.property('deleted');
            expect(res.body.customer).not.to.be.true;
            done();
        });       
    });
});