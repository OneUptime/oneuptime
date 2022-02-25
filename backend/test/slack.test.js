process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));

import app from '../server'
const request = chai.request.agent(app);
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import GlobalConfig from './utils/globalConfig'

// eslint-disable-next-line
let token,
    projectId;

describe('Slack API', function() {
    this.timeout(20000);

    this.beforeAll(function(done) {
        this.timeout(30000);
        GlobalConfig.initTestConfig().then(function() {
            request
                .post('/user/signup')
                .send(userData.user)
                .end(function(err, res) {
                    projectId = res.body.projectId;
                    request
                        .post('/user/login')
                        .send({
                            email: userData.user.email,
                            password: userData.user.password,
                        })
                        .end(function(err, res) {
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
    it('The purchase', function(done) {
        request
            .get(`/team/${projectId}/team`)
            .send({
                name: 'New Schedule',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it.skip('The purchase', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/slack/${projectId}/:teamId`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                done();
            });
    });
});
