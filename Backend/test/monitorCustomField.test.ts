process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
const expect: $TSFixMe = chai.expect;
import userData from './data/user';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request: $TSFixMe = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import AirtableService from '../backend/services/airtableService';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ComponentService from '../backend/services/componentService';
import MonitorCustomFieldService from '../backend/services/monitorCustomField';

describe('Monitor Custom Field API', function (): void {
    const timeout: $TSFixMe = 30000;
    let projectId: ObjectID,
        userId: $TSFixMe,
        token: $TSFixMe,
        authorization: $TSFixMe,
        monitorCustomFieldId: $TSFixMe;

    const monitorFieldText: $TSFixMe = {
            fieldName: 'textField',
            fieldType: 'text',
        },
        monitorFieldNumber: $TSFixMe = {
            fieldName: 'numField',
            fieldType: 'number',
        };

    this.timeout(timeout);

    before((done: $TSFixMe): void => {
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
                                            authorization = `Basic ${token}`;
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
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await ComponentService.hardDeleteBy({ projectId });
        await MonitorCustomFieldService.hardDeleteBy({ projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not create a monitor custom field when field name is missing or not specified', (done: $TSFixMe): void => {
        request
            .post(`/monitorCustomField/${projectId}`)
            .send({ fieldType: 'text' })
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Field name is required');
                done();
            });
    });

    it('should not create a monitor custom field when field type is missing or not specified', (done: $TSFixMe): void => {
        request
            .post(`/monitorCustomField/${projectId}`)
            .send({ fieldName: 'missingType' })
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Field type is required');
                done();
            });
    });

    it('should setup custom fields for all monitors in a project (text)', (done: $TSFixMe): void => {
        request
            .post(`/monitorCustomField/${projectId}`)
            .send(monitorFieldText)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                monitorCustomFieldId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.fieldName).to.be.equal(
                    monitorFieldText.fieldName
                );
                done();
            });
    });

    it('should not create monitor custom field with an existing name in a project', (done: $TSFixMe): void => {
        request
            .post(`/monitorCustomField/${projectId}`)
            .send(monitorFieldText)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Custom field with this name already exist'
                );
                done();
            });
    });

    it('should update a particular monitor custom field in a project', (done: $TSFixMe): void => {
        monitorFieldText.fieldName = 'newName';

        request
            .put(`/monitorCustomField/${projectId}/${monitorCustomFieldId}`)
            .send(monitorFieldText)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(res.body.fieldName).to.be.equal(
                    monitorFieldText.fieldName
                );
                expect(String(res.body._id)).to.be.equal(
                    String(monitorCustomFieldId)
                );
                done();
            });
    });

    it('should list all the monitor custom fields in a project', (done: $TSFixMe): void => {
        // add one more monitor custom field
        request
            .post(`/monitorCustomField/${projectId}`)
            .send(monitorFieldNumber)
            .set('Authorization', authorization)
            .end((): void => {
                request
                    .get(`/monitorCustomField/${projectId}?skip=0&limit=10`)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        expect(res.body.count).to.be.equal(2);
                        expect(res.body.data).to.be.an('array');
                        done();
                    });
            });
    });

    it('should delete a particular monitor custom field in a project', (done: $TSFixMe): void => {
        request
            .delete(`/monitorCustomField/${projectId}/${monitorCustomFieldId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                expect(String(res.body._id)).to.be.equal(
                    String(monitorCustomFieldId)
                );
                done();
            });
    });
});
