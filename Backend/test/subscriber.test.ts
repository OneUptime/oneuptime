process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import GlobalConfig from './utils/globalConfig';
import UserService from '../backend/services/userService';
import StatusPageService from '../backend/services/statusPageService';
import ProjectService from '../backend/services/projectService';
import NotificationService from '../backend/services/notificationService';
import SubscriberService from '../backend/services/subscriberService';
import MonitorService from '../backend/services/monitorService';
import AirtableService from '../backend/services/airtableService';
import StringUtil from './utils/string';

import VerificationTokenModel from '../backend/models/verificationToken';
import ComponentModel from '../backend/models/component';
import ComponentService from '../backend/services/componentService';

let projectId: ObjectID,
    userId,
    monitorId: $TSFixMe,
    token: $TSFixMe,
    subscriberId: $TSFixMe,
    statusPageId: $TSFixMe,
    componentId: $TSFixMe;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};
const csvData = {
    data: [
        {
            alertVia: 'sms',
            contactEmail: '',
            contactPhone: StringUtil.generateRandomDigits(),
            contactWebhook: '',
            countryCode: 'us',
        },
        {
            alertVia: 'email',
            contactEmail:
                StringUtil.generateRandomString(10) + '@oneuptime.com',
            contactPhone: '',
            contactWebhook: '',
            countryCode: '',
        },
    ],
};

describe('Subscriber API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function (): void {
            createUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: $TSFixMe): void {
                    projectId = res.body.project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        function (
                            err: $TSFixMe,
                            verificationToken: $TSFixMe
                        ): void {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end(function (): void {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })
                                        .end(function (
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ) {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            const authorization = `Basic ${token}`;
                                            ComponentModel.create({
                                                name: 'New Component',
                                            }).then(component => {
                                                componentId = component._id;
                                                request
                                                    .post(
                                                        `/monitor/${projectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        ...monitor,
                                                        componentId,
                                                    })
                                                    .end(function (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ) {
                                                        monitorId =
                                                            res.body._id;
                                                        expect(
                                                            res.body.name
                                                        ).to.be.equal(
                                                            monitor.name
                                                        );
                                                        request
                                                            .post(
                                                                `/StatusPage/${projectId}`
                                                            )
                                                            .set(
                                                                'Authorization',
                                                                authorization
                                                            )
                                                            .send({
                                                                links: [],
                                                                title: 'Status title',
                                                                name: 'Status name',
                                                                description:
                                                                    'status description',
                                                                copyright:
                                                                    'status copyright',
                                                                projectId,
                                                                monitorIds: [
                                                                    monitorId,
                                                                ],
                                                            })
                                                            .end(function (
                                                                err: $TSFixMe,
                                                                res: $TSFixMe
                                                            ) {
                                                                statusPageId =
                                                                    res.body
                                                                        ._id;
                                                                expect(
                                                                    res
                                                                ).to.have.status(
                                                                    200
                                                                );
                                                                done();
                                                            });
                                                    });
                                            });
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await StatusPageService.hardDeleteBy({ projectId: projectId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await SubscriberService.hardDeleteBy({ projectId: projectId });
        await MonitorService.hardDeleteBy({ projectId: projectId });
        await ComponentService.hardDeleteBy({ _id: componentId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should register subscriber with valid monitorIds and contact email or phone number', (done: $TSFixMe) => {
        request
            .post(`/subscriber/${projectId}/${statusPageId}`)
            .send({
                monitors: [monitorId],
                userDetails: {
                    email: userData.user.email,
                    phone_number: userData.user.companyPhoneNumber,
                    country: '+234',
                    method: 'email',
                },
            })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                subscriberId = res.body[0]._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0].contactEmail).to.be.equal(
                    userData.user.email
                );
                done();
            });
    });

    it('should not register subscriber without contact email or phone number', (done: $TSFixMe) => {
        request
            .post(`/subscriber/${projectId}/${statusPageId}`)
            .send({
                monitorIds: monitorId,
            })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get list of subscribers to a project', (done: $TSFixMe) => {
        request
            .get(`/subscriber/${projectId}`)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get list of subscribers to a monitorId', (done: $TSFixMe) => {
        request
            .get(`/subscriber/${projectId}/monitor/${monitorId}`)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should get a subscriber', (done: $TSFixMe) => {
        request
            .get(`/subscriber/${projectId}/${subscriberId}`)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should delete a subscriber', function (done: $TSFixMe): void {
        const authorization = `Basic ${token}`;
        request
            .delete(`/subscriber/${projectId}/${subscriberId}`)
            .set('Authorization', authorization)
            .end(function (err: $TSFixMe, res: $TSFixMe): void {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('Should upload subscribers from a csv file', (done: $TSFixMe) => {
        request
            .post(`/subscriber/${projectId}/${monitorId}/csv`)
            .send(csvData)
            .end((_err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.have.lengthOf(2);
                expect(res.body[0]).to.have.property('_id');
                expect(res.body[0]).to.have.property('projectId');
                done();
            });
    });

    it('Should not register subscriber twice on the same monitor', (done: $TSFixMe) => {
        request
            .post(`/subscriber/${projectId}/${monitorId}/csv`)
            .send(csvData)
            .end((_err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body[0]).to.not.have.property('_id');
                expect(res.body[0]).to.not.have.property('projectId');
                done();
            });
    });

    it('Should ignore exisiting subscribers and register only new subscribers from the svc file', (done: $TSFixMe) => {
        csvData.data.push({
            alertVia: 'sms',
            contactEmail: '',
            contactPhone: StringUtil.generateRandomDigits(),
            contactWebhook: '',
            countryCode: 'us',
        });
        request
            .post(`/subscriber/${projectId}/${monitorId}/csv`)
            .send(csvData)
            .end((_err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body[0]).to.not.have.property('_id');
                expect(res.body[0]).to.not.have.property('projectId');
                expect(res.body[1]).to.not.have.property('_id');
                expect(res.body[1]).to.not.have.property('projectId');
                expect(res.body[2]).to.have.property('_id');
                expect(res.body[2]).to.have.property('projectId');
                done();
            });
    });

    it('Should not register subscribers if scv file is blank', (done: $TSFixMe) => {
        csvData.data = [];
        request
            .post(`/subscriber/${projectId}/${monitorId}/csv`)
            .send(csvData)
            .end((_err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('Empty files submitted');
                done();
            });
    });
});
