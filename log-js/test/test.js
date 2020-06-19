/* eslint-disable no-undef */
process.env.STRIPE_PRIVATE_KEY = 'sk_test_YxwnzywggtAd8jDaHecNmHiN';

const chai = require('chai');
chai.use(require('chai-http'));

const stripe = require('stripe')(process.env.STRIPE_PRIVATE_KEY);

const expect = chai.expect;
import { user, generateRandomBusinessEmail } from './util';
const API_URL = 'http://localhost:3002/api/';
const request = chai.request.agent(API_URL);

import Logger from '../src/logger';

describe('Logger', function() {
    let projectId, token, componentId, applicationLog;
    // create a new user
    user.email = generateRandomBusinessEmail();
    const component = { name: 'Our Component' };
    before(function(done) {
        this.timeout(20000);
        request
            .post('stripe/checkCard')
            .send({
                tokenId: 'tok_visa',
                email: user.email,
                companyName: user.companyName,
            })
            .end(function(err, res) {
                stripe.paymentIntents.confirm(res.body.id, function(
                    err,
                    paymentIntent
                ) {
                    user.paymentIntent = {
                        id: paymentIntent.id,
                    };
                    request
                        .post('user/signup')
                        .send(user)
                        .end(function(err, res) {
                            const project = res.body.project;
                            projectId = project._id;
                            token = res.body.tokens.jwtAccessToken;
                            request
                                .post(`component/${projectId}`)
                                .set('Authorization', `Basic ${token}`)
                                .send(component)
                                .end(function(err, res) {
                                    componentId = res.body._id;
                                    request
                                        .post(
                                            `application-log/${projectId}/${componentId}/create`
                                        )
                                        .set('Authorization', `Basic ${token}`)
                                        .send({ name: 'Application Logger' })
                                        .end(function(err, res) {
                                            expect(res).to.have.status(200);
                                            expect(res.body).to.be.an('object');
                                            expect(res.body).to.have.property(
                                                '_id'
                                            );
                                            applicationLog = res.body;
                                            done();
                                        });
                                });
                        });
                });
            });
    });
    it('should request for application log key', function() {
        const firstLog = new Logger(API_URL, applicationLog._id, '');
        firstLog.log('here').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal(
                'Application Log Key is required.'
            );
        });
    });
    it('should request for content', function() {
        const firstLog = new Logger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        firstLog.log('').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal(
                'Content to be logged is required.'
            );
        });
    });
    it('should return invalid application log', function() {
        const firstLog = new Logger(API_URL, applicationLog._id, 'key');
        firstLog.log('content').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal(
                'Application Log does not exist.'
            );
        });
    });
    it('should return a valid logged item of type string', function() {
        const validLog = new Logger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.log(logMessage).then(response => {
            expect(response.status).to.equal(200);
            expect(response.data).to.be.an('object');
            expect(response.data.content).to.be.a('string');
            expect(response.data).to.include({ content: logMessage });
        });
    });
    it('should return a valid logged item of type object', function() {
        const validLog = new Logger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = {
            message: 'This is a simple log',
            user: { name: 'Jon', email: 'accurate@y.co.uk' },
        };
        validLog.log(logMessage).then(response => {
            expect(response.status).to.equal(200);
            expect(response.data).to.be.an('object');
            expect(response.data.content).to.be.an('object');
            expect(response.data.content).to.include({
                message: logMessage.message,
            });
            expect(response.data.content.user).to.include({
                name: logMessage.user.name,
            });
            expect(response.data.content.user).to.include({
                email: logMessage.user.email,
            });
        });
    });
    it('should return a valid logged item with log type of error', function() {
        const validLog = new Logger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.error(logMessage).then(response => {
            expect(response.status).to.equal(200);
            expect(response.data).to.be.an('object');
            expect(response.data.content).to.be.a('string');
            expect(response.data).to.include({ type: 'error' });
        });
    });
    it('should return a valid logged item with log type of warning', function() {
        const validLog = new Logger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.warning(logMessage).then(response => {
            expect(response.status).to.equal(200);
            expect(response.data).to.be.an('object');
            expect(response.data.content).to.be.a('string');
            expect(response.data).to.include({ type: 'warning' });
        });
    });
});
