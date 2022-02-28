process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'error';
process.env.API_URL = 'http://localhost:3002';

import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(process.env.API_URL);

import utils from './test-utils';
const expect = require('chai').expect;
import serverMonitor from '../lib/api';

const user = require('./test-utils').user;
user.email = utils.generateRandomBusinessEmail();

let token, projectId: $TSFixMe, apiKey: $TSFixMe, monitorId: $TSFixMe;
const badProjectId = 'badProjectId',
    badApiKey = 'badApiKey';
const invalidProjectId = utils.generateRandomString();
const timeout = 5000,
    monitor = {
        name: 'New Monitor',
        type: 'server-monitor',
        data: {},
    };

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Server Monitor', function() {
    this.timeout(timeout + 1000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done: $TSFixMe) {
        this.timeout(30000);

        request
            .post('/user/signup')
            .send(user)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;

                projectId = project._id;
                apiKey = project.apiKey;

                request
                    .post('/user/login')
                    .send({
                        email: user.email,
                        password: user.password,
                    })
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        token = res.body.tokens.jwtAccessToken;
                        request
                            .post(`/monitor/${projectId}`)
                            .set('Authorization', `Basic ${token}`)
                            .send(monitor)
                            .end(function(err: $TSFixMe, res: $TSFixMe) {
                                expect(res).to.have.status(200);
                                expect(res.body).to.be.an('object');
                                expect(res.body).to.have.property('_id');
                                monitorId = res.body._id;
                                done();
                            });
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should connect when project id, api key and monitor id are provided', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId,
            apiKey,
            monitorId,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(stopJob).to.be.an('object');

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should connect when project id, custom api url, api key and monitor id are provided', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId,
            apiUrl: 'http://localhost:3002',
            apiKey,
            monitorId,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(stopJob).to.be.an('object');

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should request for monitor id when only project id and api key are provided', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId,
            apiKey,
            monitorId: (data: $TSFixMe) => {
                const filteredMonitor = data.filter(
                    (monitor: $TSFixMe) => monitor._id === monitorId
                );

                if (filteredMonitor.length > 0) {
                    return monitorId;
                }
            },
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(stopJob).to.be.an('object');

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should disconnect when project id is invalid', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId: invalidProjectId,
            apiKey: badApiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal('Project Id is not valid');
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should disconnect when project id or api key are incorrect', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId: badProjectId,
            apiKey: badApiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal(
                'No Project found with this API Key and Project ID.'
            );
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should disconnect when project id is correct and api key is incorrect', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId,
            apiKey: badApiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal(
                'No Project found with this API Key and Project ID.'
            );
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should disconnect when project id is incorrect and api key is correct', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId: badProjectId,
            apiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal(
                'No Project found with this API Key and Project ID.'
            );
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('Should disconnect when timeout provided is exceeded', (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        const monitor = serverMonitor({
            projectId,
            apiKey,
            monitorId,
            timeout,
        });

        monitor.start().then((job: $TSFixMe) => {
            expect(job).to.be.an('object');
            expect(job).to.have.property('running');
            expect(job.running).to.equal(true);

            setTimeout(() => {
                expect(job.running).to.equal(false);

                done();
            }, timeout);
        });
    });
});
