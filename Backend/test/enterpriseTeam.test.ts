process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createEnterpriseUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';

let token: $TSFixMe, projectId: ObjectID, newProjectId: ObjectID;

const teamEmail = 'noreply1@oneuptime.com';

describe('Enterprise Team API', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createEnterpriseUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project = res.body.project;
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
            email: {
                $in: [userData.user.email.toLowerCase(), teamEmail],
            },
        });
    });

    it('should add new user with valid details for project with no billing plan', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/team/${projectId}`)
            .set('Authorization', authorization)
            .send({
                emails: teamEmail,
                role: 'Member',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res.body[0].team[0].userId).to.be.a('string');
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
});
