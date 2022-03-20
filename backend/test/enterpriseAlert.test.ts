process.env['PORT'] = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import incidentData from './data/incident';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createEnterpriseUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import MonitorService from '../backend/services/monitorService';
import IncidentService from '../backend/services/incidentService';
import AlertService from '../backend/services/alertService';
import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    incidentId: $TSFixMe,
    alertId: $TSFixMe;

describe('Enterprise Alert API', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function () {
            createEnterpriseUser(
                request,
                userData.user,
                function (err: $TSFixMe, res: Response) {
                    const project = res.body.project;
                    projectId = project._id;

                    ComponentModel.create({ name: 'New Component' }).then(
                        component => {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end(function (err: $TSFixMe, res: Response) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
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
                                        .end(function (
                                            err: $TSFixMe,
                                            res: Response
                                        ) {
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

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await IncidentService.hardDeleteBy({ _id: incidentId });
        await AlertService.hardDeleteBy({ _id: alertId });
    });

    it('should create alert with valid details for project with no billing plan', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end(function (err: $TSFixMe, res: Response) {
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
                    .end(function (err: $TSFixMe, res: Response) {
                        alertId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        done();
                    });
            });
    });
});
