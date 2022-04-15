process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import incidentData from './data/incident';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createEnterpriseUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import MonitorService from '../backend/services/monitorService';
import IncidentService from '../backend/services/incidentService';
import AlertService from '../backend/services/alertService';
import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    projectId: ObjectID,
    monitorId: $TSFixMe,
    incidentId: $TSFixMe,
    alertId: $TSFixMe;

describe('Enterprise Alert API', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createEnterpriseUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;

                    ComponentModel.create({ name: 'New Component' }).then(
                        (component:  $TSFixMe) => {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end((err: $TSFixMe, res: $TSFixMe): void => {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization: string = `Basic ${token}`;
                                    request
                                        .post(`/monitor/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send({
                                            name: 'New Monitor',
                                            type: 'url',
                                            data: {
                                                url: 'http://www.tests.org',
                                            },
                                            componentId: component._id,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            monitorId = res.body._id;
                                            incidentData.monitors = [monitorId];
                                            done();
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
        await ProjectService.hardDeleteBy({ _id: projectId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await IncidentService.hardDeleteBy({ _id: incidentId });
        await AlertService.hardDeleteBy({ _id: alertId });
    });

    it('should create alert with valid details for project with no billing plan', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                incidentId = res.body._id;
                request
                    .post(`/alert/${projectId}`)
                    .set('Authorization', authorization)
                    .send({
                        monitorId,
                        alertVia: 'email',
                        incidentId,
                        eventType: 'identified',
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        alertId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        done();
                    });
            });
    });
});
