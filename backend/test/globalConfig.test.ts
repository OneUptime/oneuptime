// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import data from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chai-http);
import app from '../server'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import AirtableService from '../backend/services/airtableService'
import GlobalConfigService from '../backend/services/globalConfigService'
import VerificationTokenModel from '../backend/models/verificationToken'
import GlobalConfig from './utils/globalConfig'
let projectId: $TSFixMe, userId: $TSFixMe, token: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Global Config API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(100000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, data.user, function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                projectId = project._id;
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
                                    email: data.user.email,
                                    password: data.user.password,
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create global config when name and value are valid', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const globalConfig = {
            name: 'TestName',
            value: 'TestValue',
        };
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfig)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal(globalConfig.name);
                expect(res.body.value).to.equal(globalConfig.value);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create multiple global configs when details are valid', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const globalConfigs = [
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
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create global config when name and value are not valid', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const globalConfig = { name: null };
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send(globalConfig)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get multiple global configs when names are provided', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        const globalConfigs = ['TestName', 'Other TestName'];
        request
            .post('/globalConfig/configs')
            .set('Authorization', authorization)
            .send(globalConfigs)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get global config by name', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get('/globalConfig/TestName')
            .set('Authorization', authorization)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('TestName');
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should retrieve global config for audit Log status', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get('/globalConfig/auditLogMonitoringStatus')
            .set('Authorization', authorization)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('auditLogMonitoringStatus');
                expect(res.body.value).to.equal(true);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should toggle global config for audit Log status', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post('/globalConfig')
            .set('Authorization', authorization)
            .send({ name: 'auditLogMonitoringStatus', value: false })
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body.name).to.equal('auditLogMonitoringStatus');
                expect(res.body.value).to.equal(false);
                done();
            });
    });
});
