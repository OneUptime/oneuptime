process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import MonitorService from '../backend/services/monitorService';
import ZapierService from '../backend/services/zapierService';
import AirtableService from '../backend/services/airtableService';

import VerificationTokenModel from '../backend/models/verificationToken';
import incidentData from './data/incident';

// eslint-disable-next-line
let token: $TSFixMe, projectId: ObjectID, apiKey: string, userId, zapierId: $TSFixMe, monitorId: $TSFixMe, incidentId: $TSFixMe;

const monitor: $TSFixMe = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

describe('Zapier API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;
                    userId = res.body.id;
                    apiKey = project.apiKey;

                    VerificationTokenModel.findOne(
                        { userId },
                        (err: $TSFixMe, verificationToken: $TSFixMe): void => {
                            request
                                .get(
                                    `/user/confirmation/${verificationToken.token}`
                                )
                                .redirects(0)
                                .end((): void => {
                                    request
                                        .post('/user/login')
                                        .send({
                                            email: userData.user.email,
                                            password: userData.user.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            const authorization: string = `Basic ${token}`;
                                            request
                                                .post(`/monitor/${projectId}`)
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send(monitor)
                                                .end(
                                                    (
                                                        err: $TSFixMe,
                                                        res: $TSFixMe
                                                    ) => {
                                                        monitorId =
                                                            res.body._id;
                                                        incidentData.monitors =
                                                            [monitorId];
                                                        const authorization: string = `Basic ${token}`;
                                                        request
                                                            .post(
                                                                `/incident/${projectId}/create-incident`
                                                            )
                                                            .set(
                                                                'Authorization',
                                                                authorization
                                                            )
                                                            .send(incidentData)
                                                            .end((): void => {
                                                                request
                                                                    .post(
                                                                        `/incident/${projectId}/create-incident`
                                                                    )
                                                                    .set(
                                                                        'Authorization',
                                                                        authorization
                                                                    )
                                                                    .send(
                                                                        incidentData
                                                                    )
                                                                    .end(
                                                                        (): void => {
                                                                            done();
                                                                        }
                                                                    );
                                                            });
                                                    }
                                                );
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async (): void => {
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
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await ZapierService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
        delete require.cache[require.resolve('../server')];
        app.close();
    });

    it('should not subscribe to zapier when missing apiKey in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not subscribe to zapier when missing url as a parameter', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                type: 'created',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not subscribe to zapier when missing type as a parameter', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                url: 'https://www.oneuptime.com',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should subscribe to zapier service', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/zapier/subscribe?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send({
                url: 'https://www.oneuptime.com',
                type: 'created',
                input: { monitors: ['12345'] },
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                zapierId = res.body.id;
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail getting test and apiKey is missing in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/test?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting test and projectId is missing in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/test?apiKey=${apiKey}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    /* :TODO
    it('should get zapier test', function (done):void {
        let authorization:string = `Basic ${token}`;
        request.get(`/zapier/test?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send().end(function (err: $TSFixMe, res: $TSFixMe):void {
                expect(res).to.have.status(200);
                done();
            });
    });
    */

    it('should fail getting incidents and apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .get(`/zapier/incidents?projectId=${projectId}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting incidents and projectId is missing in query', (done: $TSFixMe): void => {
        request
            .get(`/zapier/incidents?apiKey=${apiKey}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get zapier incidents', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/incidents?apiKey=${apiKey}&&projectId=${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail getting resolved and apiKey is missing in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/incident/resolved?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting resolved and projectId is missing in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/incident/resolved?apiKey=${apiKey}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get zapier resolved', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(
                `/zapier/incident/resolved?apiKey=${apiKey}&&projectId=${projectId}`
            )
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail getting acknowledged and apiKey is missing in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/incident/acknowledged?projectId=${projectId}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail when getting acknowledged and projectId is missing in query', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/zapier/incident/acknowledged?apiKey=${apiKey}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get zapier acknowledged', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(
                `/zapier/incident/acknowledged?apiKey=${apiKey}&&projectId=${projectId}`
            )
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should unsubscribe to zapier', (done: $TSFixMe): void => {
        request
            .delete(
                `/zapier/unsubscribe/${zapierId}?apiKey=${apiKey}&&projectId=${projectId}`
            )
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should fail to create incidents when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/createIncident?projectId=${projectId}`)
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to create incidents when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/createIncident?apiKey=${apiKey}`)
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should create incident', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/createIncident?apiKey=${apiKey}&projectId=${projectId}`
            )
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                incidentId = res.body.incidents[0]._id;
                done();
            });
    });

    it('should fail to acknowledge an incident when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/acknowledgeIncident?projectId=${projectId}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to acknowledge an incident when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/acknowledgeIncident?apiKey=${apiKey}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should acknowledge an incident', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/acknowledgeIncident?apiKey=${apiKey}&projectId=${projectId}`
            )
            .send({
                incidents: [incidentId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });

    it('should fail to resolve an incident when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/resolveIncident?projectId=${projectId}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to resolve an incident when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/resolveIncident?apiKey=${apiKey}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should resolve an incident', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/resolveIncident?apiKey=${apiKey}&projectId=${projectId}`
            )
            .send({
                incidents: [incidentId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });

    it('should fail to acknowledge last incidents when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/acknowledgeLastIncident?projectId=${projectId}`
            )
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to acknowledge last incidents when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/acknowledgeLastIncident?apiKey=${apiKey}`)
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should acknowledge last incident', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/acknowledgeLastIncident?apiKey=${apiKey}&projectId=${projectId}`
            )
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });

    it('should fail to resolve last incidents when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/resolveLastIncident?projectId=${projectId}`)
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to resolve last incidents when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/resolveLastIncident?apiKey=${apiKey}`)
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should resolve last incident', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/resolveLastIncident?apiKey=${apiKey}&projectId=${projectId}`
            )
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });

    it('should fail to acknowledge all incidents when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/acknowledgeAllIncidents?projectId=${projectId}`
            )
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to acknowledge all incidents when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/acknowledgeAllIncidents?apiKey=${apiKey}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should acknowledge all incident', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end((): void => {
                request
                    .post(`/incident/${projectId}/create-incident`)
                    .set('Authorization', authorization)
                    .send(incidentData)
                    .end((): void => {
                        request
                            .post(
                                `/zapier/incident/acknowledgeAllIncidents?apiKey=${apiKey}&projectId=${projectId}`
                            )
                            .send({
                                monitors: [monitorId],
                            })
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                expect(res).to.have.status(200);
                                expect(res.body).to.be.an('object');
                                expect(res.body).to.have.property('incidents');
                                expect(res.body.incidents.length).to.be.equal(
                                    1
                                );
                                expect(
                                    res.body.incidents[0].acknowledged
                                ).to.be.equal(true);
                                done();
                            });
                    });
            });
    });

    it('should fail to resolve all incidents when apiKey is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/resolveAllIncidents?projectId=${projectId}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should fail to resolve all incidents when projectId is missing in query', (done: $TSFixMe): void => {
        request
            .post(`/zapier/incident/resolveAllIncidents?apiKey=${apiKey}`)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should resolve all incident', (done: $TSFixMe): void => {
        request
            .post(
                `/zapier/incident/resolveAllIncidents?apiKey=${apiKey}&projectId=${projectId}`
            )
            .send({
                monitors: [monitorId],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('incidents');
                expect(res.body.incidents.length).to.be.equal(1);
                expect(res.body.incidents[0].acknowledged).to.be.equal(true);
                done();
            });
    });
});
