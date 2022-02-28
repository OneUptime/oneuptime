// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import VerificationTokenModel from '../backend/models/verificationToken';
import SsoService from '../backend/services/ssoService';
import ProjectService from '../backend/services/projectService';

const ssoObject = {
    'saml-enable': true,
    domain: 'hackerbay.com',
    samlSsoUrl: 'hackerbay.com/login',
    certificateFingerprint: 'azertyuiop',
    remoteLogoutUrl: 'hackerbay.com/logout',
    ipRanges: '127.0.0.1',
};

let token: $TSFixMe, userId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('SSO API', function() {
    this.timeout(300000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.adminUser, function(
                err: $TSFixMe,
                res: $TSFixMe
            ) {
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    err: $TSFixMe,
                    verificationToken: $TSFixMe
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function() {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.adminUser.email,
                                    password: userData.adminUser.password,
                                })
                                .end(function(err: $TSFixMe, res: $TSFixMe) {
                                    token = res.body.tokens.jwtAccessToken;
                                    UserService.updateBy(
                                        { _id: userId },
                                        { role: 'master-admin' }
                                    ).then(function() {
                                        done();
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
        await ProjectService.hardDeleteBy({ 'users.userId': userId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.adminUser.email,
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
    describe('should reject requests from an unauthenticated users', function() {
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should reject GET requests', function(done: $TSFixMe) {
            request.get('/sso').end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(401);
                done();
            });
        });
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should reject POST requests', function(done: $TSFixMe) {
            request.post('/sso').end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(401);
                done();
            });
        });
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should reject PUT requests', function(done: $TSFixMe) {
            request
                .put('/sso/5ea951228877984ea9f47660')
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(401);
                    done();
                });
        });
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should reject DELETE requests', function(done: $TSFixMe) {
            request
                .delete('/sso/5ea951228877984ea9f47660')
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(401);
                    done();
                });
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
    describe('GET /sso/', function() {
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should return SSOs list with count', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            request
                .get('/sso')
                .set('Authorization', authorization)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    done();
                });
        });
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should return SSOs list with count, skip and limit (when skip&limit specified)', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            request
                .get('/sso?limit=10&skip=0')
                .set('Authorization', authorization)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('data');
                    expect(res.body).to.have.property('count');
                    expect(res.body).to.have.property('limit');
                    expect(res.body).to.have.property('skip');
                    done();
                });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
    describe('POST /sso', function() {
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should create a new SSO', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(ssoObject)
                .end(async function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('_id');
                    expect(res.body).to.have.property('domain');
                    expect(res.body).to.have.property('samlSsoUrl');
                    expect(res.body).to.have.property('remoteLogoutUrl');

                    const sso = await SsoService.findOneBy({
                        query: { _id: res.body._id },
                        select: ' _id domain samlUrl remoteLogoutUrl',
                    });
                    expect(sso).to.be.an('object');
                    expect(sso).to.have.property('_id');
                    expect(sso).to.have.property('domain');
                    expect(sso).to.have.property('samlSsoUrl');
                    expect(sso).to.have.property('remoteLogoutUrl');

                    await SsoService.hardDeleteBy({ _id: res.body._id });
                    done();
                });
        });

        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should not create a new SSO if domaine is not defined', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            const payload = { ...ssoObject };
            // @ts-expect-error ts-migrate(2790) FIXME: The operand of a 'delete' operator must be optiona... Remove this comment to see the full error message
            delete payload.domain;

            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(payload)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(400);
                    done();
                });
        });

        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should not create a new SSO if Saml SSO url is not defined', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            const payload = { ...ssoObject };
            // @ts-expect-error ts-migrate(2790) FIXME: The operand of a 'delete' operator must be optiona... Remove this comment to see the full error message
            delete payload.samlSsoUrl;

            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(payload)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(400);
                    done();
                });
        });

        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should not create a new SSO if remote logout url is not defined', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            const payload = { ...ssoObject };
            // @ts-expect-error ts-migrate(2790) FIXME: The operand of a 'delete' operator must be optiona... Remove this comment to see the full error message
            delete payload.remoteLogoutUrl;

            request
                .post('/sso')
                .set('Authorization', authorization)
                .send(payload)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
    describe('DELETE /sso', function() {
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should delete sso', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            SsoService.create(ssoObject).then(sso => {
                const { _id: ssoId } = sso;
                request
                    .delete(`/sso/${ssoId}`)
                    .set('Authorization', authorization)
                    .end(async function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.have.property('_id');
                        expect(res.body).to.have.property('domain');
                        expect(res.body).to.have.property('samlSsoUrl');
                        expect(res.body).to.have.property('remoteLogoutUrl');
                        const deletedSso = await SsoService.findOneBy({
                            query: { _id: res.body._id, deleted: true },
                            select: 'deleted',
                        });

                        expect(deletedSso).to.be.an('object');
                        expect(deletedSso.deleted).to.equal(true);

                        SsoService.hardDeleteBy({ _id: res.body._id });
                        done();
                    });
            });
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
    describe('UPDATE /sso', function() {
        // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it('should update SSO', function(done: $TSFixMe) {
            const authorization = `Basic ${token}`;
            SsoService.create(ssoObject).then(sso => {
                const { _id: ssoId } = sso;
                const updatedSsoObject = { ...ssoObject };
                updatedSsoObject.domain = 'updated.hackerbay.com';
                updatedSsoObject.samlSsoUrl = 'updated.hackerbay.com/login';
                updatedSsoObject.remoteLogoutUrl =
                    'updated.hackerbay.com/logout';
                request
                    .put(`/sso/${ssoId}`)
                    .set('Authorization', authorization)
                    .send(updatedSsoObject)
                    .end(async function(err: $TSFixMe, res: $TSFixMe) {
                        expect(res).to.have.status(200);
                        expect(res.body[0]).to.be.an('object');
                        expect(res.body[0].domain).to.equal(
                            updatedSsoObject.domain
                        );

                        const sso = await SsoService.findOneBy({
                            query: { _id: ssoId },
                            select: 'domain samlSsoUrl remoteLogoutUrl ',
                        });
                        expect(sso.domain).to.equal(updatedSsoObject.domain);
                        expect(sso.samlSsoUrl).to.equal(
                            updatedSsoObject.samlSsoUrl
                        );
                        expect(sso.remoteLogoutUrl).to.equal(
                            updatedSsoObject.remoteLogoutUrl
                        );

                        await SsoService.hardDeleteBy({ _id: ssoId });
                        done();
                    });
            });
        });
    });
});
