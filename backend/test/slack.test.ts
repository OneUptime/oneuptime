// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));

import app from '../server'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import GlobalConfig from './utils/globalConfig'

// eslint-disable-next-line
let token: $TSFixMe,
    projectId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Slack API', function(this: $TSFixMe) {
    this.timeout(20000);

    this.beforeAll(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(30000);
        GlobalConfig.initTestConfig().then(function() {
            request
                .post('/user/signup')
                .send(userData.user)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    projectId = res.body.projectId;
                    request
                        .post('/user/login')
                        .send({
                            email: userData.user.email,
                            password: userData.user.password,
                        })
                        .end(function(err: $TSFixMe, res: $TSFixMe) {
                            token = res.body.tokens.jwtAccessToken;
                            done();
                        });
                });
        });
    });

    this.afterAll(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    'noreply@oneuptime.com',
                ],
            },
        });
    });

    // 'post /slack/:projectId/monitor'
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('The purchase', function(done: $TSFixMe) {
        request
            .get(`/team/${projectId}/team`)
            .send({
                name: 'New Schedule',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it.skip('The purchase', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .get(`/slack/${projectId}/:teamId`)
            .set('Authorization', authorization)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
});
