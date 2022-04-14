import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const expect = chai.expect;
import { user, generateRandomBusinessEmail } from './util';
const API_URL: string = 'http://localhost:3002/api';

const request: $TSFixMe = chai.request.agent(API_URL);
const timeout = 5000;

import OneUptimeLogger from '../src/logger';

describe('OneUptimeLogger', function (): void {
    const sleep: Function = (milliseconds: $TSFixMe): void => {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    };
    this.timeout(timeout + 1000);
    let projectId: ObjectID,
        token: $TSFixMe,
        componentId,
        applicationLog: $TSFixMe;
    // create a new user
    const component: $TSFixMe = { name: 'Our Component' };

    before(function (done: $TSFixMe): void {
        this.timeout(60000);
        sleep(5000).then(() => {
            user.email = generateRandomBusinessEmail();
            request
                .post('/user/signup')
                .send(user)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    const project = res.body.project;
                    projectId = project._id;
                    token = res.body.tokens.jwtAccessToken;
                    request
                        .post(`/component/${projectId}`)
                        .set('Authorization', `Basic ${token}`)
                        .send(component)
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            componentId = res.body._id;
                            request
                                .post(
                                    `/application-log/${projectId}/${componentId}/create`
                                )
                                .set('Authorization', `Basic ${token}`)
                                .send({ name: 'Application OneUptimeLogger' })
                                .end((err: $TSFixMe, res: $TSFixMe): void => {
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

    it('should request for application log key', (): void => {
        const firstLog = new OneUptimeLogger(API_URL, applicationLog._id, '');
        firstLog.log('here').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal(
                'Application Log Key is required.'
            );
        });
    });

    it('should request for content', (): void => {
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

    it('should return invalid application log', (): void => {
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

    it('should return a valid logged item of type string', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        validLog.log(logMessage).then(response => {
            expect(response.status).to.equal(200);

            expect(response.data).to.be.an('object');

            expect(response.data.content).to.be.a('string');

            expect(response.data).to.include({ content: logMessage });
        });
    });

    it('should return a valid logged item of type object', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: $TSFixMe = {
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

    it('should return a valid logged item with log type of error', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        validLog.error(logMessage).then(response => {
            expect(response.status).to.equal(200);

            expect(response.data).to.be.an('object');

            expect(response.data.content).to.be.a('string');

            expect(response.data).to.include({ type: 'error' });
        });
    });

    it('should return a valid logged item with log type of warning', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        validLog.warning(logMessage).then(response => {
            expect(response.status).to.equal(200);

            expect(response.data).to.be.an('object');

            expect(response.data.content).to.be.a('string');

            expect(response.data).to.include({ type: 'warning' });
        });
    });

    it('should return a valid logged item with log type of info with one tag', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        const tag: string = 'trial';

        validLog.log(logMessage, tag).then(response => {
            expect(response.status).to.equal(200);

            expect(response.data).to.be.an('object');

            expect(response.data.content).to.be.a('string');

            expect(response.data).to.include({ type: 'info' });

            expect(response.data.tags).to.be.an('array');

            expect(response.data.tags).to.have.lengthOf(1);

            expect(response.data.tags).to.include(tag);
        });
    });

    it('should return a valid logged item with log type of warning with no tag', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        validLog.warning(logMessage).then(response => {
            expect(response.status).to.equal(200);

            expect(response.data).to.be.an('object');

            expect(response.data.content).to.be.a('string');

            expect(response.data).to.include({ type: 'warning' });
        });
    });

    it('should return a valid logged item with log type of error with 3 tags', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        const tags = ['auction', 'trial', 'famous'];

        validLog.error(logMessage, tags).then(response => {
            expect(response.status).to.equal(200);

            expect(response.data).to.be.an('object');

            expect(response.data.content).to.be.a('string');

            expect(response.data).to.include({ type: 'error' });

            expect(response.data.tags).to.be.an('array');

            expect(response.data.tags).to.have.lengthOf(tags.length);
            tags.forEach(tag => {
                expect(response.data.tags).to.include(tag);
            });
        });
    });

    it('should reject a valid logged item with log type of error with invalid tags', (): void => {
        const validLog = new OneUptimeLogger(
            API_URL,
            applicationLog._id,
            applicationLog.key
        );
        const logMessage: string = 'This is a simple log';
        const tags: $TSFixMe = { type: 'trying things' };

        validLog.error(logMessage, tags).then(response => {
            expect(response).to.equal('Invalid Content Tags to be logged');
        });
    });
});
