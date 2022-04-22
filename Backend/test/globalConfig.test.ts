process.env.PORT = 3020;
import data from './data/user';
import chai, { expect } from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfigService from '../backend/services/globalConfigService';
import VerificationTokenModel from '../backend/models/verificationToken';
import GlobalConfig from './utils/globalConfig';
let projectId: ObjectID, userId: ObjectID, token: $TSFixMe;

describe('Global Config API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(100000);
        GlobalConfig.initTestConfig().then((): void => {
            createUser(
                request,
                data.user,
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
                                            email: data.user.email,
                                            password: data.user.password,
                                        })
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            token =
                                                res.body.tokens.jwtAccessToken;
                                            UserService.updateBy(
                                                { _id: userId },
                                                { role: 'master-admin' }
                                            ).then((): void => {
                                                done();
                                            });
                                        });
                                });
                        }
                    );
                }
            );
        });
    });

    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: data.user.email.toLowerCase(),
        });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfigService.hardDeleteBy({
            name: {
                $in: ['TestName', 'Other TestName', 'auditLogMonitoringStatus'],
            },
        });
    });

    it('should create global config when name and value are valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const globalConfig: $TSFixMe = {
            name: 'TestName',
            value: 'TestValue',
        };
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfig)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal(globalConfig.name);
                expect(res.body.value).to.equal(globalConfig.value);
                done();
            });
    });

    it('should create multiple global configs when details are valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const globalConfigs: $TSFixMe = [
            {
                name: 'TestName',
                value: 'TestValue',
            },
            {
                name: 'Other TestName',
                value: 'Other TestValue',
            },
        ];
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfigs)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data.length).to.equal(2);
                expect(res.body.data[0]).to.have.property('name');
                expect(res.body.data[0]).to.have.property('value');
                expect(res.body.data[0].name).to.equal(globalConfigs[1].name);
                expect(res.body.data[0].value).to.equal(globalConfigs[1].value);
                expect(res.body.data[1]).to.have.property('name');
                expect(res.body.data[1]).to.have.property('value');
                expect(res.body.data[1].name).to.equal(globalConfigs[0].name);
                expect(res.body.data[1].value).to.equal(globalConfigs[0].value);
                done();
            });
    });

    it('should not create global config when name and value are not valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const globalConfig: $TSFixMe = { name: null };
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfig)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should get multiple global configs when names are provided', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const globalConfigs: $TSFixMe = ['TestName', 'Other TestName'];
        request
            .post('/globalConfig/configs')
            .set('Authorization', authorization)
            .send(globalConfigs)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data.length).to.equal(2);
                expect(res.body.data[0]).to.have.property('name');
                expect(res.body.data[0]).to.have.property('value');
                expect(res.body.data[0].name).to.equal('Other TestName');
                expect(res.body.data[1]).to.have.property('name');
                expect(res.body.data[1]).to.have.property('value');
                expect(res.body.data[1].name).to.equal('TestName');
                done();
            });
    });

    it('should get global config by name', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get('/globalConfig/TestName')
            .set('Authorization', authorization)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('TestName');
                done();
            });
    });

    it('should retrieve global config for audit Log status', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get('/globalConfig/auditLogMonitoringStatus')
            .set('Authorization', authorization)
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('auditLogMonitoringStatus');
                expect(res.body.value).to.equal(true);
                done();
            });
    });

    it('should toggle global config for audit Log status', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send({ name: 'auditLogMonitoringStatus', value: false })
            .end(async (err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('auditLogMonitoringStatus');
                expect(res.body.value).to.equal(false);
                done();
            });
    });
});
