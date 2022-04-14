process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import VerificationTokenModel from '../backend/models/verificationToken';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';

let token: $TSFixMe, projectId: ObjectID, refreshToken: $TSFixMe, userId;

describe('Jwt Token API', function (): void {
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
                                            refreshToken =
                                                res.body.tokens.jwtRefreshToken;
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
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should get new access and refresh token when provided a valid jwtRefreshToken', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/token/new')
            .set('Authorization', authorization)
            .send({ refreshToken: refreshToken })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });
});
