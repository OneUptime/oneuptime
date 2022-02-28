// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chaihttp);
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createEnterpriseUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import ComponentService from '../backend/services/componentService'

let token: $TSFixMe, projectId: $TSFixMe, newProjectId: $TSFixMe, componentId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Enterprise Component API', function() {
    this.timeout(30000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function( done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createEnterpriseUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                projectId = project._id;

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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await ComponentService.hardDeleteBy({ _id: componentId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a new component for project with no billing plan', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Test Project',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                newProjectId = res.body._id;
                request
                    .post(`/component/${newProjectId}`)
                    .set('Authorization', authorization)
                    .send({
                        name: 'New Component',
                    })
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        componentId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body.name).to.be.equal('New Component');
                        done();
                    });
            });
    });
});
