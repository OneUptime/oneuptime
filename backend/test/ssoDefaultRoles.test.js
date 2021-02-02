/* eslint-disable no-undef */
process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const request = chai.request.agent(app);

const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const AirtableService = require('../backend/services/airtableService');
const GlobalConfig = require('./utils/globalConfig');
const VerificationTokenModel = require('../backend/models/verificationToken');
const SsoService = require('../backend/services/ssoService');
const testUtils = require('./utils/test-utils');


let adminAuthorizationHeader, adminId, projectId,ssoId1,ssoId2;

const sso1CreationPayload = {
    'saml-enabled': 
        true,
    domain: 
        'tests.hackerbay.io',
    samlSsoUrl:
        'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
    remoteLogoutUrl: 
        'http://localhost:9876/logout',
}

const sso2CreationPayload = {
    'saml-enabled': 
        true,
    domain: 
        'tests1.hackerbay.io',
    samlSsoUrl:
        'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
    remoteLogoutUrl: 
        'http://localhost:9876/logout',
}

const roles= ['Administrator', 'Member', 'Viewer']

describe('SSO DEFAULT ROLES API', function() {
    this.timeout(300000);
    before(async function() {
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
        adminAuthorizationHeader = testUtils.getAuthorizationHeader({jwtToken:response1.body.tokens.jwtAccessToken});
        await UserService.updateBy(
            {
                _id: adminId,
            },
            {
                role: 'master-admin',
            }
        );
        const projectCreationPayload =  {
           planId: "plan_GoWKiTdQ6NiQFw",
           projectName: 'PROJECT_NAME',
          }
        const project = await testUtils.createProject({
          request,
          authorization: adminAuthorizationHeader,
          payload:projectCreationPayload
        })
        projectId = project.body._id;
        const sso1 = await testUtils.createSso({
            request,
            authorization: adminAuthorizationHeader,
            payload:sso1CreationPayload,
        }) 
        ssoId1 = sso1.body._id;

        const sso2 = await testUtils.createSso({
            request,
            authorization: adminAuthorizationHeader,
            payload:sso2CreationPayload,
        }) 
        ssoId2 = sso2.body._id;
    });
    it('should create a default SSO role for a domain, in a project',async ()=>{
        const payload ={
            domain:ssoId1,
            project:projectId,
            role: "Member"
        }
        const response = await testUtils.createSsoDefaultRole({
            request,
            authorization: adminAuthorizationHeader,
            payload
        });
        expect(response).to.have.status(200);
        expect(response.body).to.be.an('Object');
        expect(response.body).to.have.property('domain');
        expect(response.body).to.have.property('project');
        expect(response.body).to.have.property('role');
    })

    it('should not create a default SSO role for a domain that already has a default role for a specific project',async ()=>{
        const payload = {
            domain:ssoId1,
            project:projectId,
        };
        for(const role of roles){
            payload.role = role;
            const response = await testUtils.createSsoDefaultRole({
                request,
                authorization: adminAuthorizationHeader,
                payload
            });
            expect(response).to.have.status(400);
        }
    })

});
