process.env['PORT'] = 3020;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import moment from 'moment';
import GlobalConfig from './utils/globalConfig';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';

import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import IncidentService from '../backend/services/incidentService';
import MonitorService from '../backend/services/monitorService';
import NotificationService from '../backend/services/notificationService';
import AirtableService from '../backend/services/airtableService';

import VerificationTokenModel from '../backend/models/verificationToken';
import ComponentModel from '../backend/models/component';

let token: $TSFixMe, userId, projectId: ObjectID, monitorId: $TSFixMe;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};
const endDate = moment().format('YYYY-MM-DD');
const startDate = moment().subtract(7, 'd').format('YYYY-MM-DD');
const filter = 'month';

describe('Reports API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    const project = res.body.project;
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
                                            const authorization: string = `Basic ${token}`;
                                            ComponentModel.create({
                                                name: 'Test Component',
                                            }).then(component => {
                                                request
                                                    .post(
                                                        `/monitor/${projectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        ...monitor,
                                                        componentId:
                                                            component._id,
                                                    })
                                                    .end(
                                                        (
                                                            err: $TSFixMe,
                                                            res: $TSFixMe
                                                        ) => {
                                                            monitorId =
                                                                res.body._id;
                                                            done();
                                                        }
                                                    );
                                            });
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
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should return list of most active members', (done: $TSFixMe) => {
        const authorization: string = `Basic ${token}`;

        request
            .get(
                `/reports/${projectId}/active-members?startDate=${startDate}&&endDate=${endDate}&&skip=0&&limit=10`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should return list of most active monitors', (done: $TSFixMe) => {
        const authorization: string = `Basic ${token}`;
        request
            .get(
                `/reports/${projectId}/active-monitors?startDate=${startDate}&&endDate=${endDate}&&skip=0&&limit=10`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should return average resolved incidents time', (done: $TSFixMe) => {
        const authorization: string = `Basic ${token}`;
        request
            .get(
                `/reports/${projectId}/average-resolved?startDate=${startDate}&&endDate=${endDate}&&filter=${filter}`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should return number of incidents', (done: $TSFixMe) => {
        const authorization: string = `Basic ${token}`;
        request
            .get(
                `/reports/${projectId}/incidents?startDate=${startDate}&&endDate=${endDate}&&filter=${filter}`
            )
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });
});
