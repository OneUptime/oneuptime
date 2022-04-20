process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'error';
process.env.API_URL = 'http://localhost:3002';

import chai, { expect } from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request: $TSFixMe = chai.request.agent(process.env.API_URL);

import utils from './test-utils';
import serverMonitor from '../lib/api';

const user: $TSFixMe = require('./test-utils').user;
user.email = utils.generateRandomBusinessEmail();

let token: $TSFixMe, projectId: ObjectID, apiKey: string, monitorId: $TSFixMe;
const badProjectId: string = 'badProjectId',
    badApiKey: $TSFixMe = 'badApiKey';
const invalidProjectId: string = utils.generateRandomString();
const timeout: $TSFixMe = 5000,
    monitor: $TSFixMe = {
        name: 'New Monitor',
        type: 'server-monitor',
        data: {},
    };

describe('Server Monitor', function (): void {
    this.timeout(timeout + 1000);

    before(function (done: $TSFixMe): void {
        this.timeout(30000);

        request
            .post('/user/signup')
            .send(user)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                const project: $TSFixMe = res.body.project;

                projectId = project._id;
                apiKey = project.apiKey;

                request
                    .post('/user/login')
                    .send({
                        email: user.email,
                        password: user.password,
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        token = res.body.tokens.jwtAccessToken;
                        request
                            .post(`/monitor/${projectId}`)
                            .set('Authorization', `Basic ${token}`)
                            .send(monitor)
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                expect(res).to.have.status(200);
                                expect(res.body).to.be.an('object');
                                expect(res.body).to.have.property('_id');
                                monitorId = res.body._id;
                                done();
                            });
                    });
            });
    });

    it('Should connect when project id, api key and monitor id are provided', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId,
            apiKey,
            monitorId,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(stopJob).to.be.an('object');

            done();
        });
    });

    it('Should connect when project id, custom api url, api key and monitor id are provided', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId,
            apiUrl: 'http://localhost:3002',
            apiKey,
            monitorId,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(stopJob).to.be.an('object');

            done();
        });
    });

    it('Should request for monitor id when only project id and api key are provided', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId,
            apiKey,
            monitorId: (data: $TSFixMe) => {
                const filteredMonitor: $TSFixMe = data.filter(
                    (monitor: $TSFixMe) => {
                        return monitor._id === monitorId;
                    }
                );

                if (filteredMonitor.length > 0) {
                    return monitorId;
                }
            },
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(stopJob).to.be.an('object');

            done();
        });
    });

    it('Should disconnect when project id is invalid', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId: invalidProjectId,
            apiKey: badApiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal('Project Id is not valid');
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    it('Should disconnect when project id or api key are incorrect', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId: badProjectId,
            apiKey: badApiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal(
                'No Project found with this API Key and Project ID.'
            );
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    it('Should disconnect when project id is correct and api key is incorrect', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId,
            apiKey: badApiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal(
                'No Project found with this API Key and Project ID.'
            );
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    it('Should disconnect when project id is incorrect and api key is correct', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
            projectId: badProjectId,
            apiKey,
        });

        monitor.start().then((job: $TSFixMe) => {
            const stopJob: $TSFixMe = monitor.stop();

            expect(job).to.be.an('object');
            expect(job).to.haveOwnProperty('message');
            expect(job.message).to.equal(
                'No Project found with this API Key and Project ID.'
            );
            expect(stopJob).to.equal(undefined);

            done();
        });
    });

    it('Should disconnect when timeout provided is exceeded', (done: $TSFixMe) => {
        const monitor: $TSFixMe = serverMonitor({
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
