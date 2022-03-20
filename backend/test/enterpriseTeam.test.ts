process.env['PORT'] = 3020;
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

let token: $TSFixMe, projectId: $TSFixMe, newProjectId: $TSFixMe;

const teamEmail = 'noreply1@oneuptime.com';

describe('Enterprise Team API', function () {
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

                    request
                        .post('/user/login')
                        .send({
                            email: userData.user.email,
                            password: userData.user.password,
                        })
                        .end(function (err: $TSFixMe, res: Response) {
                            token = res.body.tokens.jwtAccessToken;
                            done();
                        });
                }
            );
        });
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await UserService.hardDeleteBy({
            email: {
                $in: [userData.user.email.toLowerCase(), teamEmail],
            },
        });
    });

    it('should add new user with valid details for project with no billing plan', function (done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: teamEmail,
                role: 'Member',
            })
            .end(function (err: $TSFixMe, res: Response) {
                expect(res.body[0].team[0].userId).to.be.a('string');
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
});
