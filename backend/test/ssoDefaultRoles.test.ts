process.env['PORT'] = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import VerificationTokenModel from '../backend/models/verificationToken';
import SsoService from '../backend/services/ssoService';
import SsoDefaultRolesService from '../backend/services/ssoDefaultRolesService';
import queryString from 'query-string';
import testUtils from './utils/test-utils';

testUtils.setShared({ request });
let adminId: $TSFixMe,
    userId: $TSFixMe,
    adminAuthorizationHeader: $TSFixMe,
    projectId1: $TSFixMe,
    projectId2: $TSFixMe,
    ssoId1: $TSFixMe,
    ssoId2: $TSFixMe,
    ssoDefaultRole1: $TSFixMe,
    ssoDefaultRole2: $TSFixMe,
    ssoDefaultRole3: $TSFixMe;

/**
 *  ssoId1 <-> ssoDefaultRole1  <-> projectId1
 *  ssoId1 <-> ssoDefaultRole3  <-> projectId2
 *  ssoId2 <-> ssoDefaultRole2  <-> projectId1
 */

const sso1CreationPayload = {
    'saml-enabled': true,
    domain: 'tests.hackerbay.io',
    samlSsoUrl: 'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
    remoteLogoutUrl: 'http://localhost:9876/logout',
};

const sso2CreationPayload = {
    'saml-enabled': true,
    domain: 'tests1.hackerbay.io',
    samlSsoUrl: 'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
    remoteLogoutUrl: 'http://localhost:9876/logout',
};

const roles = ['Administrator', 'Member', 'Viewer'];
const ssoUsers = [
    {
        email: 'user1@tests.hackerbay.io',
        username: 'user1',
        password: 'user1pass',
    },
    {
        email: 'user2@tests.hackerbay.io',
        username: 'user2',
        password: 'user2pass',
    },
];

const projectCreationPayloads = [
    {
        planId: 'plan_GoWKiTdQ6NiQFw',
        projectName: 'PROJECT_1',
    },
    {
        planId: 'plan_GoWKiTdQ6NiQFw',
        projectName: 'PROJECT_2',
    },
];

describe('SSO DEFAULT ROLES API', function () {
    this.timeout(300000);

    before(async function () {
        this.timeout(40000);
        await GlobalConfig.initTestConfig();
        const response = await createUser(request, userData.adminUser);
        adminId = response.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId: adminId,
        });
        await request
            .get(`/user/confirmation/${verificationToken.token}`)
            .redirects(0);
        const response1 = await request.post('/user/login').send({
            email: userData.adminUser.email,
            password: userData.adminUser.password,
        });
        adminAuthorizationHeader = testUtils.getAuthorizationHeader({
            jwtToken: response1.body.tokens.jwtAccessToken,
        });

        testUtils.setShared({ authorization: adminAuthorizationHeader });
        await UserService.updateBy(
            {
                _id: adminId,
            },
            {
                role: 'master-admin',
            }
        );
        const project = await testUtils.createProject({
            payload: projectCreationPayloads[0],
        });
        projectId1 = project.body._id;
        const sso1 = await testUtils.createSso({
            payload: sso1CreationPayload,
        });
        ssoId1 = sso1.body._id;

        const sso2 = await testUtils.createSso({
            payload: sso2CreationPayload,
        });
        ssoId2 = sso2.body._id;
    });

    after(async function () {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ 'users.userId': userId });
        await UserService.hardDeleteBy({
            _id: {
                $in: [adminId, userId],
            },
        });
        await SsoDefaultRolesService.hardDeleteBy({
            _id: {
                $in: [ssoDefaultRole1, ssoDefaultRole2, ssoDefaultRole3],
            },
        });
        await ProjectService.hardDeleteBy({
            'users.userId': {
                $in: [adminId, userId],
            },
        });

        await SsoService.hardDeleteBy({
            _id: {
                $in: [ssoId1, ssoId2],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it("should not create an 'Owner' role as default SSO role for a domain, in a project", async () => {
        const payload = {
            domain: ssoId1,
            project: projectId1,
            role: 'Owner',
        };
        const response = await testUtils.createSsoDefaultRole({ payload });
        expect(response).to.have.status(400);
        expect(response.body).to.be.an('Object');
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.equal('Invalid role.');
    });

    it('should create a default SSO role for a domain, in a project', async () => {
        const payload = {
            domain: ssoId1,
            project: projectId1,
            role: 'Member',
        };
        const response = await testUtils.createSsoDefaultRole({ payload });
        expect(response).to.have.status(200);
        expect(response.body).to.be.an('Object');
        expect(response.body).to.have.property('_id');
        expect(response.body).to.have.property('domain');
        expect(response.body).to.have.property('project');
        expect(response.body).to.have.property('role');
        ssoDefaultRole1 = response.body._id;
    });

    it('should not create a default SSO role for a domain that already has a default role for a specific project', async () => {
        const payload = {
            domain: ssoId1,
            project: projectId1,
        };
        for (const role of roles) {
            payload.role = role;
            const response = await testUtils.createSsoDefaultRole({ payload });
            expect(response).to.have.status(400);
        }
    });

    it('should create a new default SSO role for a different SSO domain, in the same project', async () => {
        const payload = {
            domain: ssoId2,
            project: projectId1,
            role: 'Member',
        };
        const response = await testUtils.createSsoDefaultRole({ payload });
        expect(response).to.have.status(200);
        expect(response.body).to.be.an('Object');
        expect(response.body).to.have.property('_id');
        expect(response.body).to.have.property('domain');
        expect(response.body).to.have.property('project');
        expect(response.body).to.have.property('role');
        ssoDefaultRole2 = response.body._id;
    });

    it('should fetch the existing default sso roles', async () => {
        const result = await testUtils.fetchSsoDefaultRoles();
        expect(result.body).to.be.an('Object');
        expect(result.body).to.have.property('count');
        expect(result.body).to.have.property('data');
        expect(result.body.count).to.equal(2);
    });

    it('should update the existing default SSO role', async () => {
        const payload = {
            domain: ssoId1,
            project: projectId1,
            role: 'Administrator',
        };
        const updateEndpointResponse = await testUtils.updateSsoDefaultRole({
            id: ssoDefaultRole1,
            payload,
        });
        expect(updateEndpointResponse).to.have.status(200);
        expect(updateEndpointResponse.body).to.be.an('Object');

        const getEndpointResponse = await testUtils.fetchSsoDefaultRole({
            id: ssoDefaultRole1,
        });
        expect(getEndpointResponse).to.have.status(200);
        expect(getEndpointResponse.body).to.be.an('Object');
        expect(getEndpointResponse.body).to.have.property('role');
        expect(getEndpointResponse.body.role).to.equal('Administrator');
    });

    it('should automatically add the new SSO users to the existing projects with roles defined on default SSO roles', async () => {
        const user = ssoUsers[0];

        testUtils.unsetShared('authorization');
        const ssoLoginRequest = await testUtils.ssoLogin({ email: user.email });
        expect(ssoLoginRequest).to.have.status(200);
        expect(ssoLoginRequest.body).to.have.property('url');
        const { url: SAMLRequest } = ssoLoginRequest.body;
        const SAMLResponse = await testUtils.fetchIdpSAMLResponse({
            SAMLRequest,
            username: user.username,
            password: user.password,
        });
        const response = await request
            .post('/api/user/sso/callback')
            .redirects(0)
            .send({ SAMLResponse });
        expect(response).to.have.status(302);
        const {
            header: { location: loginLink },
        } = response;

        testUtils.setShared({ authorization: adminAuthorizationHeader });
        const projectRequest = await testUtils.fetchProject({
            projectId: projectId1,
        });
        const parsedQuery = queryString.parse(loginLink.split('?')[1]);
        expect(!!parsedQuery.id).to.equal(true);
        userId = parsedQuery.id;
        expect(projectRequest).to.have.status(200);
        expect(projectRequest.body).to.be.an('Object');
        expect(projectRequest.body).to.have.property('users');
        expect(projectRequest.body.users).to.be.an('Array');
        expect(
            projectRequest.body.users.some(
                (user: $TSFixMe) =>
                    user.role === 'Administrator' && user.userId === userId
            )
        ).to.equal(true);
    });

    it('should automatically add existing SSO users to the new projects with roles defined on SSO default roles', async () => {
        const project = await testUtils.createProject({
            payload: projectCreationPayloads[1],
        });
        projectId2 = project.body._id;

        const payload = {
            domain: ssoId1,
            project: projectId2,
            role: 'Member',
        };
        const response = await testUtils.createSsoDefaultRole({ payload });
        expect(response).to.have.status(200);
        expect(response.body).to.be.an('Object');
        expect(response.body).to.have.property('_id');
        expect(response.body).to.have.property('domain');
        expect(response.body).to.have.property('project');
        expect(response.body).to.have.property('role');
        ssoDefaultRole3 = response.body._id;

        const projectRequest = await testUtils.fetchProject({
            projectId: projectId2,
        });
        expect(projectRequest).to.have.status(200);
        expect(projectRequest.body).to.be.an('Object');
        expect(projectRequest.body).to.have.property('users');
        expect(projectRequest.body.users).to.be.an('Array');
        expect(
            projectRequest.body.users.some(
                (user: $TSFixMe) =>
                    user.role === 'Member' && user.userId === userId
            )
        ).to.equal(true);
    });

    it('should delete the existing default sso roles with removing the SSO users from existing the projects', async () => {
        const deleteResponse = await testUtils.deleteSsoDefaultRole({
            id: ssoDefaultRole3,
        });
        expect(deleteResponse).to.have.status(200);
        const projectRequest = await testUtils.fetchProject({
            projectId: projectId2,
        });
        expect(projectRequest).to.have.status(200);
        expect(projectRequest.body).to.be.an('Object');
        expect(projectRequest.body).to.have.property('users');
        expect(projectRequest.body.users).to.be.an('Array');
        expect(
            projectRequest.body.users.some(
                (user: $TSFixMe) =>
                    user.role === 'Member' && user.userId === userId
            )
        ).to.equal(true);
    });

    it('should delete all default SSO roles related to a SSO, when the SSO is deleted', async () => {
        const deleteResponse = await testUtils.deleteSso({ id: ssoId2 });
        expect(deleteResponse).to.have.status(200);
        const fetchResponse = await testUtils.fetchSsoDefaultRole({
            id: ssoDefaultRole2,
        });
        expect(fetchResponse).to.have.status(404);
    });

    it('should delete all default SSO roles related to a project, when the project is deleted', async () => {
        const deleteResponse = await testUtils.deleteProject({
            id: projectId2,
        });
        expect(deleteResponse).to.have.status(200);
        const fetchResponse = await testUtils.fetchSsoDefaultRole({
            id: ssoDefaultRole2,
        });
        expect(fetchResponse).to.have.status(404);
    });
});
