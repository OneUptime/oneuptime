process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import { expect } from 'chai';
import userData from './data/user';
import dockerCredential from './data/dockerCredential';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request: $TSFixMe = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import DockerCredentialService from '../backend/services/dockerCredentialService';
import AirtableService from '../backend/services/airtableService';

describe('Docker Credential API', function (): void {
    const timeout: $TSFixMe = 30000;
    let projectId: ObjectID,
        userId: $TSFixMe,
        token: $TSFixMe,
        credentialId: $TSFixMe;
    const dockerRegistryUrl: $TSFixMe = dockerCredential.dockerRegistryUrl;
    const dockerUsername: $TSFixMe = dockerCredential.dockerUsername;
    const dockerPassword: $TSFixMe = dockerCredential.dockerPassword;

    this.timeout(timeout);

    before(async (): void => {
        await GlobalConfig.initTestConfig();
        const res: $TSFixMe = await createUser(request, userData.user);
        const project: $TSFixMe = res.body.project;
        projectId = project._id;
        userId = res.body.id;
        const verificationToken: $TSFixMe =
            await VerificationTokenModel.findOne({
                userId,
            });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const res1: $TSFixMe = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = res1.body.tokens.jwtAccessToken;
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: userData.user.email,
        });
        await DockerCredentialService.hardDeleteBy({
            projectId,
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should add docker credential', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            });
        credentialId = res.body._id;
        expect(res).to.have.status(200);
        expect(res.body.dockerRegistryUrl).to.be.equal(dockerRegistryUrl);
    });

    it('should update a docker credential', async (): void => {
        const authorization: string = `Basic ${token}`;
        const dockerUsername: string = 'username';
        const dockerPassword: string = 'hello1234567890';

        const res: $TSFixMe = await request
            .put(`/credential/${projectId}/dockerCredential/${credentialId}`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            });
        expect(res).to.have.status(200);
        expect(res.body.dockerUsername).to.be.equal(dockerUsername);
    });

    it('should not update docker credential with invalid username or password', async (): void => {
        const authorization: string = `Basic ${token}`;
        const dockerUsername: string = 'randomUsername';
        const dockerPassword: string = 'randomPassword';
        const res: $TSFixMe = await request
            .put(`/credential/${projectId}/dockerCredential/${credentialId}`)
            .set('Authorization', authorization)
            .send({ dockerRegistryUrl, dockerUsername, dockerPassword });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Invalid docker credential');
    });

    it('should not add docker credential if username or password is invalid', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername: 'randomusername',
                dockerPassword: 'invalidpassword',
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Invalid docker credential');
    });

    it('should remove a docker credential', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .delete(`/credential/${projectId}/dockerCredential/${credentialId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body._id).to.be.equal(credentialId);
        expect(res.body.deleted).to.be.true;
    });

    it('should get all the docker credentials in a project', async (): void => {
        const authorization: string = `Basic ${token}`;
        await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            });
        const res: $TSFixMe = await request
            .get(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
    });

    it('should not create docker credential with an existing docker registry url and docker username in a project', async (): void => {
        const authorization: string = `Basic ${token}`;

        const res: $TSFixMe = await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Docker Credential already exist in this project'
        );
    });

    it('should not create docker credential if docker registry url is missing', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl: '',
                dockerUsername,
                dockerPassword,
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Docker Registry URL is required');
    });

    it('should not create docker credential if docker username is missing', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername: '',
                dockerPassword,
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Docker Username is required');
    });

    it('should not create docker credential if docker password is missing', async (): void => {
        const authorization: string = `Basic ${token}`;
        const res: $TSFixMe = await request
            .post(`/credential/${projectId}/dockerCredential`)
            .set('Authorization', authorization)
            .send({
                dockerRegistryUrl,
                dockerUsername: 'username',
            });
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal('Docker Password is required');
    });

    it('should not remove a non-existing docker credential', async (): void => {
        const authorization: string = `Basic ${token}`;
        const newCredentialId: string = '5e8db97b2cc46e3a229ebc62'; // non-existing credential id
        const res: $TSFixMe = await request
            .delete(
                `/credential/${projectId}/dockerCredential/${newCredentialId}`
            )
            .set('Authorization', authorization);
        expect(res).to.have.status(400);
        expect(res.body.message).to.be.equal(
            'Docker Credential not found or does not exist'
        );
    });
});
