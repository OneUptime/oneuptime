process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
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

import ComponentModel from '../backend/models/component';

let token: $TSFixMe,
    projectId: $TSFixMe,
    newProjectId: $TSFixMe,
    monitorId: $TSFixMe;

describe('Enterprise Monitor API', function () {
    this.timeout(30000);

    before(function (done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function () {
            createEnterpriseUser(request, userData.user, function (
                err: $TSFixMe,
                req: Response
            ) {
                const project = res.body.project;
                projectId = project._id;

                request
                    .post('/user/login')
                    .send({
                        email: userData.user.email,
                        password: userData.user.password,
                    })
                    .end(function (err: $TSFixMe, req: Response) {
                        token = res.body.tokens.jwtAccessToken;
                        done();
                    });
            });
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
    });

    it('should create a new monitor for project with no billing plan', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        ComponentModel.create({ name: 'Test Component' }).then(component => {
            request
                .post('/project/create')
                .set('Authorization', authorization)
                .send({
                    projectName: 'Test Project',
                })
                .end(function (err: $TSFixMe, req: Response) {
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
                        .end(function (err: $TSFixMe, req: Response) {
                            monitorId = res.body._id;
                            expect(res).to.have.status(200);
                            expect(res.body.name).to.be.equal('New Monitor');
                            done();
                        });
                });
        });
    });
});
