// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import data from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chai-http);
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createEnterpriseUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'

let projectId: $TSFixMe, newProjectId: $TSFixMe, userRole: $TSFixMe, token: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Enterprise User API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createEnterpriseUser(request, data.user, function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                projectId = project._id;
                userRole = res.body.role;

                request
                    .post('/user/login')
                    .send({
                        email: data.user.email,
                        password: data.user.password,
                    })
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        token = res.body.tokens.jwtAccessToken;
                        done();
                    });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    data.user.email.toLowerCase(),
                    data.newUser.email.toLowerCase(),
                ],
            },
        });
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should sign up initial user as `master-admin`', function() {
        expect(userRole).to.equal('master-admin');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should confirm that `master-admin` exists', function(done: $TSFixMe) {
        request.get('/user/masterAdminExists').end(function(err: $TSFixMe, res: $TSFixMe) {
            expect(res).to.have.status(200);
            expect(res.body).have.property('result');
            expect(res.body.result).to.eql(true);
            done();
        });
    });

    // 'post /user/signup'
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should register `user` without stripeToken, stripePlanId', function(done: $TSFixMe) {
        createEnterpriseUser(request, data.newUser, function(err: $TSFixMe, res: $TSFixMe) {
            const project = res.body.project;
            newProjectId = project._id;
            expect(res).to.have.status(200);
            expect(res.body.email).to.equal(
                data.newUser.email.toLocaleLowerCase()
            );
            expect(res.body.role).to.equal('user');
            done();
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should login with valid credentials', function(done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(
                    data.newUser.email.toLocaleLowerCase()
                );
                expect(res.body).include.keys('tokens');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should login with valid credentials, and return sent redirect url', function(done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
                redirect: 'http://oneuptime.com',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.email).to.equal(
                    data.newUser.email.toLocaleLowerCase()
                );
                expect(res.body).have.property('redirect');
                expect(res.body.redirect).to.eql('http://oneuptime.com');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get list of users without their hashed passwords', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get('/user/users')
            .set('Authorization', authorization)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data.length).to.eql(2);
                const { data } = res.body;
                for (const element of data) {
                    expect(element).to.be.an('object');
                    expect(element).to.not.have.property('password');
                }
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should turn off 2fa for a user', function(done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .then(function(res: $TSFixMe) {
                const jwtToken = res.body.tokens.jwtAccessToken;
                request
                    .put('/user/profile')
                    .set('Authorization', `Basic ${jwtToken}`)
                    .send({
                        twoFactorAuthEnabled: true,
                        email: data.newUser.email,
                    })
                    .then(function(res: $TSFixMe) {
                        request
                            .put(`/user/${res.body._id}/2fa`)
                            .set('Authorization', `Basic ${token}`)
                            .send({
                                email: data.newUser.email.toLocaleLowerCase(),
                                twoFactorAuthEnabled: !res.body
                                    .twoFactorAuthEnabled,
                            })
                            .end(function(err: $TSFixMe, res: $TSFixMe) {
                                expect(res.body.twoFactorAuthEnabled).to.eql(
                                    false
                                );
                                done();
                            });
                    });
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not turn off 2fa for a user if loged in user is not admin', function(done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: data.newUser.email,
                password: data.newUser.password,
            })
            .then(function(res: $TSFixMe) {
                const jwtToken = res.body.tokens.jwtAccessToken;
                request
                    .put('/user/profile')
                    .set('Authorization', `Basic ${jwtToken}`)
                    .send({
                        twoFactorAuthEnabled: true,
                        email: data.newUser.email,
                    })
                    .then(function(res: $TSFixMe) {
                        request
                            .put(`/user/${res.body._id}/2fa`)
                            .set('Authorization', `Basic ${jwtToken}`)
                            .send({
                                email: data.newUser.email,
                                twoFactorAuthEnabled: !res.body
                                    .twoFactorAuthEnabled,
                            })
                            .end(function(err: $TSFixMe, result: $TSFixMe) {
                                expect(result).to.have.status(400);
                                done();
                            });
                    });
            });
    });
});
