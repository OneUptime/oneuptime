
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import GlobalConfig from './utils/globalConfig';
import incidentData from './data/incident';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import IncidentService from '../backend/services/incidentService';
import MonitorService from '../backend/services/monitorService';
import NotificationService from '../backend/services/notificationService';
import SubscriberAlertService from '../backend/services/subscriberAlertService';
import SubscriberService from '../backend/services/subscriberService';
import AirtableService from '../backend/services/airtableService';
import smtpCredentials from './data/smtpCredential';
import EmailSmtpService from '../backend/services/emailSmtpService';

import VerificationTokenModel from '../backend/models/verificationToken';

let token: $TSFixMe,
    userId: $TSFixMe,
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    incidentId: $TSFixMe,
    subscriberId: $TSFixMe,
    idNumber: $TSFixMe;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};


describe('Subcriber Alert API', function() {
    this.timeout(20000);

    
    before(function(done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(
                err: $TSFixMe,
                res: $TSFixMe
            ) {
                projectId = res.body.project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    err: $TSFixMe,
                    verificationToken: $TSFixMe
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function() {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end(function(err: $TSFixMe, res: $TSFixMe) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
                                    request
                                        .post(`/monitor/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send(monitor)
                                        .end(function(
                                            err: $TSFixMe,
                                            res: $TSFixMe
                                        ) {
                                            monitorId = res.body._id;
                                            incidentData.monitors = [monitorId];
                                            request
                                                .post(
                                                    `/incident/${projectId}/create-incident`
                                                )
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send(incidentData)
                                                .end(
                                                    (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ) => {
                                                        idNumber =
                                                            res.body.idNumber; // This has replaced incidentId and is used to query subscriber alert
                                                        incidentId =
                                                            res.body._id;
                                                        expect(
                                                            res
                                                        ).to.have.status(200);
                                                        expect(
                                                            res.body
                                                        ).to.be.an('object');
                                                        done();
                                                    }
                                                );
                                        });
                                });
                        });
                });
            });
        });
    });

    
    after(async () => {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await SubscriberService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
        await EmailSmtpService.hardDeleteBy({ projectId });
    });

    
    it('should create subscriber alert with valid incidentId, alertVia', (done: $TSFixMe) => {
        // update user to a master admin
        UserService.updateOneBy({ _id: userId }, { role: 'master-admin' }).then(
            () => {
                const authorization = `Basic ${token}`;
                // setup smtp settings
                request
                    .post(`/emailSmtp/${projectId}`)
                    .set('Authorization', authorization)
                    .send(smtpCredentials)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        expect(res).to.have.status(200);
                        request
                            .post(
                                `/subscriber/${projectId}/subscribe/${monitorId}`
                            )
                            .send({
                                alertVia: 'email',
                                contactEmail: userData.user.email,
                            })
                            .end((err: $TSFixMe, res: $TSFixMe) => {
                                subscriberId = res.body._id;
                                request
                                    .post(
                                        `/subscriberAlert/${projectId}/${subscriberId}`
                                    )
                                    .send({
                                        incidentId: incidentId,
                                        alertVia: 'email',
                                        eventType: 'identified',
                                    })
                                    .end((err: $TSFixMe, res: $TSFixMe) => {
                                        expect(res).to.have.status(200);
                                        expect(res.body).to.be.an('object');
                                        expect(res.body.alertVia).to.be.equal(
                                            'email'
                                        );
                                        SubscriberAlertService.hardDeleteBy({
                                            _id: res.body._id,
                                        });
                                        done();
                                    });
                            });
                    });
            }
        );
    });

    
    it('should not create subscriber alert with invalid alertVia', (done: $TSFixMe) => {
        request
            .post(`/subscriberAlert/${projectId}/${subscriberId}`)
            .send({
                incidentId: incidentId,
                alertVia: null,
                eventType: 'identified',
            })
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    
    it('should get subscriber alerts by projectId', (done: $TSFixMe) => {
        request
            .get(`/subscriberAlert/${projectId}`)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    
    it('should get subscriber alerts by incidentId', (done: $TSFixMe) => {
        request
            .get(`/subscriberAlert/${projectId}/incident/${idNumber}`)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });
});
