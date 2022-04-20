process.env['PORT'] = 3020;
import chai, { expect } from 'chai';
import userData from './data/user';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createEnterpriseUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';

let token: $TSFixMe, projectId: ObjectID, newProjectId: ObjectID;

describe('Enterprise Project API', function (): void {
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
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
    });

    it('should create a project when `planId` is not given', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Test Project',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                newProjectId = res.body._id;
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete a project', (done: $TSFixMe) => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/project/${projectId}/deleteProject`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should restore a deleted project', (done: $TSFixMe) => {
        const authorization: string = `Basic ${token}`;
        request
            .put(`/project/${projectId}/restoreProject`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                done();
            });
    });
});
