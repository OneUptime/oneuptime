import chai from 'chai'
chai.use(require('chai-http'));

const expect = chai.expect;
import { user, generateRandomBusinessEmail } from './util';
const API_URL = 'http://localhost:3002/api';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(API_URL);
const timeout = 5000;

import OneUptimeLogger from '../src/logger';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('OneUptimeLogger', function(this: $TSFixMe) {
    const sleep = (milliseconds: $TSFixMe) => {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    };
    this.timeout(timeout + 1000);
    let projectId: $TSFixMe, token: $TSFixMe, componentId, applicationLog: $TSFixMe;
    // create a new user
    const component = { name: 'Our Component' };

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(60000);
        sleep(5000).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{ name: s... Remove this comment to see the full error message
            user.email = generateRandomBusinessEmail();
            request
                .post('/user/signup')
                .send(user)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    const project = res.body.project;
                    projectId = project._id;
                    token = res.body.tokens.jwtAccessToken;
                    request
                        .post(`/component/${projectId}`)
                        .set('Authorization', `Basic ${token}`)
                        .send(component)
                        .end(function(err: $TSFixMe, res: $TSFixMe) {
                            componentId = res.body._id;
                            request
                                .post(
                                    `/application-log/${projectId}/${componentId}/create`
                                )
                                .set('Authorization', `Basic ${token}`)
                                .send({ name: 'Application OneUptimeLogger' })
                                .end(function(err: $TSFixMe, res: $TSFixMe) {
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Assertio... Remove this comment to see the full error message
                                    expect(res).to.have.status(200);
                                    expect(res.body).to.be.an('object');
                                    expect(res.body).to.have.property('_id');
                                    applicationLog = res.body;
                                    done();
                                });
                        });
                });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should request for application log key', function() {
        const firstLog = new OneUptimeLogger(API_URL, applicationLog._id, '');
        firstLog.log('here').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal(
                'Application Log Key is required.'
            );
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should request for content', function() {
        const firstLog = new OneUptimeLogger(
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return invalid application log', function() {
        const firstLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            'key'
        );
        firstLog.log('content').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal(
                'Application Log does not exist.'
            );
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item of type string', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.log(logMessage).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.a('string');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.include({ content: logMessage });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item of type object', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = {
            message: 'This is a simple log',
            user: { name: 'Jon', email: 'accurate@y.co.uk' },
        };
        validLog.log(logMessage).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.include({
                message: logMessage.message,
            });
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content.user).to.include({
                name: logMessage.user.name,
            });
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content.user).to.include({
                email: logMessage.user.email,
            });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item with log type of error', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.error(logMessage).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.a('string');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.include({ type: 'error' });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item with log type of warning', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.warning(logMessage).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.a('string');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.include({ type: 'warning' });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item with log type of info with one tag', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        const tag = 'trial';
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"trial"' is not assignable to pa... Remove this comment to see the full error message
        validLog.log(logMessage, tag).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.a('string');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.include({ type: 'info' });
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.tags).to.be.an('array');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.tags).to.have.lengthOf(1);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.tags).to.include(tag);
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item with log type of warning with no tag', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        validLog.warning(logMessage).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.a('string');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.include({ type: 'warning' });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should return a valid logged item with log type of error with 3 tags', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        const tags = ['auction', 'trial', 'famous'];
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string[]' is not assignable to p... Remove this comment to see the full error message
        validLog.error(logMessage, tags).then(response => {
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.status).to.equal(200);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.be.an('object');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.content).to.be.a('string');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data).to.include({ type: 'error' });
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.tags).to.be.an('array');
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            expect(response.data.tags).to.have.lengthOf(tags.length);
            tags.forEach(tag => {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                expect(response.data.tags).to.include(tag);
            });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject a valid logged item with log type of error with invalid tags', function() {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage = 'This is a simple log';
        const tags = { type: 'trying things' };
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ type: string; }' is not assign... Remove this comment to see the full error message
        validLog.error(logMessage, tags).then(response => {
            expect(response).to.equal('Invalid Content Tags to be logged');
        });
    });
});
