process.env['PORT'] = 3020;
import userData from './data/user';
import chai, { expect } from 'chai';
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

import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    projectId: ObjectID,
    newProjectId: ObjectID,
    monitorId: $TSFixMe;

describe('Enterprise Monitor API', function (): void {
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

                    request
                        .post('/user/login')
                        .send({
                            email: userData.user.email,
                            password: userData.user.password,
                        })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            token = res.body.tokens.jwtAccessToken;
                            done();
                        });
                }
            );
        });
    });

    after(async (): void => {
        GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
    });

    it('should create a new monitor for project with no billing plan', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;

        ComponentModel.create({ name: 'Test Component' }).then(
            (component: $TSFixMe) => {
                request
                    .post('/project/create')
                    .set('Authorization', authorization)
                    .send({
                        projectName: 'Test Project',
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        newProjectId = res.body._id;
                        request
                            .post(`/monitor/${newProjectId}`)
                            .set('Authorization', authorization)
                            .send({
                                name: 'New Monitor',
                                type: 'url',
                                data: { url: 'http://www.tests.org' },
                                componentId: component._id,
                            })
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                monitorId = res.body._id;
                                expect(res).to.have.status(200);
                                expect(res.body.name).to.be.equal(
                                    'New Monitor'
                                );
                                done();
                            });
                    });
            }
        );
    });
});
