// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
// @ts-expect-error ts-migrate(2322) FIXME: Type 'true' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.IS_SAAS_SERVICE = true;
import chai from 'chai'
const expect = require('chai').expect;
import userData from './data/user'
import dockerCredential from './data/dockerCredential'
import app from '../server'
chai.use(require('chai-http'));
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import VerificationTokenModel from '../backend/models/verificationToken'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import ComponentService from '../backend/services/componentService'
import DockerCredentialService from '../backend/services/dockerCredentialService'
import ContainerSecurityService from '../backend/services/containerSecurityService'
import ContainerSecurityLogService from '../backend/services/containerSecurityLogService'
import AirtableService from '../backend/services/airtableService'

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Container Security API', function(this: $TSFixMe) {
    const timeout = 30000;
    let projectId: $TSFixMe,
        componentId: $TSFixMe,
        userId: $TSFixMe,
        token: $TSFixMe,
        containerSecurityId: $TSFixMe,
        credentialId: $TSFixMe;

    this.timeout(timeout);
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done: $TSFixMe) {
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                UserService.updateOneBy(
                    { _id: userId },
                    { role: 'master-admin' }
                ).then(function() {
                    VerificationTokenModel.findOne({ userId }, function(
                        err: $TSFixMe,
                        verificationToken: $TSFixMe
                    ) {
                        request
                            .get(
                                `/user/confirmation/${verificationToken.token}`
                            )
                            .redirects(0)
                            .end(function() {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: userData.user.email,
                                        password: userData.user.password,
                                    })
                                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                                        token = res.body.tokens.jwtAccessToken;
                                        const authorization = `Basic ${token}`;

                                        request
                                            .post(`/component/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({ name: 'Test Component' })
                                            .end(function(err: $TSFixMe, res: $TSFixMe) {
                                                componentId = res.body._id;
                                                done();
                                            });
                                    });
                            });
                    });
                });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email,
        });
        await ComponentService.hardDeleteBy({ projectId });
        await DockerCredentialService.hardDeleteBy({ projectId });
        await ContainerSecurityService.hardDelete({ componentId });
        await ContainerSecurityLogService.hardDelete({ componentId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a container security', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        DockerCredentialService.create({
            dockerUsername: dockerCredential.dockerUsername,
            dockerPassword: dockerCredential.dockerPassword,
            dockerRegistryUrl: dockerCredential.dockerRegistryUrl,
            projectId,
        }).then(function(credential) {
            credentialId = credential._id;
            const data = {
                name: 'Test Container',
                dockerCredential: credential._id,
                imagePath: dockerCredential.imagePath,
                imageTags: dockerCredential.imageTags,
            };

            request
                .post(`/security/${projectId}/${componentId}/container`)
                .set('Authorization', authorization)
                .send(data)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    containerSecurityId = res.body._id;
                    expect(res).to.have.status(200);
                    expect(res.body.componentId).to.be.equal(componentId);
                    expect(res.body.name).to.be.equal(data.name);
                    expect(res.body.imagePath).to.be.equal(data.imagePath);
                    expect(res.body.imageTags).to.be.equal(data.imageTags);
                    done();
                });
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should update a container security', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const update = { name: 'Container Test' };

        request
            .put(
                `/security/${projectId}/${componentId}/container/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .send(update)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(update.name);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get a particular container security in a component', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/security/${projectId}/${componentId}/container/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(String(res.body._id)).to.be.equal(
                    String(containerSecurityId)
                );
                expect(String(res.body.componentId._id)).to.be.equal(
                    String(componentId)
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get all the container security in a component', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get all the container security with a particular credential', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .get(`/security/${projectId}/container/${credentialId}`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should scan a container security', function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(300000);
        const authorization = `Basic ${token}`;

        request
            .post(
                `/security/${projectId}/container/scan/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should throw error if scanning with an invalid docker credentials or invalid image path', function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(500000);
        const authorization = `Basic ${token}`;
        const data = {
            name: 'Wrong Container',
            dockerCredential: credentialId,
            imagePath: 'invalid/image',
            imageTags: dockerCredential.imageTags,
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                const containerSecurityId = res.body._id;
                request
                    .post(
                        `/security/${projectId}/container/scan/${containerSecurityId}`
                    )
                    .set('Authorization', authorization)
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(400);
                        expect(res.body.message).to.be.equal(
                            'Scanning failed please check your docker credential or image path/tag'
                        );
                        done();
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a container security if name already exist in the component', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const data = {
            name: 'Container Test',
            dockerCredential: credentialId,
            imagePath: dockerCredential.imagePath,
            imageTags: dockerCredential.imageTags,
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Container security with this name already exist in this component'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a container security if image path already exist in the component', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const data = {
            name: 'Another Container',
            dockerCredential: credentialId,
            imagePath: dockerCredential.imagePath,
            imageTags: dockerCredential.imageTags,
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Container security with this image path already exist in this component'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a container security if name is missing or undefined in the request body', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const data = {
            dockerCredential: credentialId,
            imagePath: dockerCredential.imagePath,
            imageTags: dockerCredential.imageTags,
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Container Security Name is required'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a container security if image path is missing or undefined in the request body', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const data = {
            name: 'Another Container',
            dockerCredential: credentialId,
            imageTags: dockerCredential.imageTags,
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Image Path is required');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a container security if dockerCredential is missing or undefined in the request body', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const data = {
            name: 'Another Container',
            imagePath: dockerCredential.imagePath,
            imageTags: dockerCredential.imageTags,
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Credential is required'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a particular container security', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;

        request
            .delete(
                `/security/${projectId}/${componentId}/container/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.deleted).to.be.true;
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not scan a container security if it does not exist', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const containerSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .post(
                `/security/${projectId}/container/scan/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Container Security not found or does not exist'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not delete a non-existing container security', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const containerSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .delete(
                `/security/${projectId}/${componentId}/container/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Container Security not found or does not exist'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not get a non-existing container security', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const containerSecurityId = '5e8db9752cc46e3a229ebc51'; // non-existing ObjectId

        request
            .get(
                `/security/${projectId}/${componentId}/container/${containerSecurityId}`
            )
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Container security not found or does not exist'
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a container security if dockerCredential does not exist', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const data = {
            name: 'Another Container',
            imagePath: dockerCredential.imagePath,
            imageTags: dockerCredential.imageTags,
            dockerCredential: '5e8db9752cc46e3a229ebc51',
        };

        request
            .post(`/security/${projectId}/${componentId}/container`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    'Docker Credential not found or does not exist'
                );
                done();
            });
    });
});
