// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import incidentData from './data/incident'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createEnterpriseUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import MonitorService from '../backend/services/monitorService'
import IncidentService from '../backend/services/incidentService'
import AlertService from '../backend/services/alertService'
import ComponentModel from '../backend/models/component'

let token: $TSFixMe, projectId: $TSFixMe, monitorId: $TSFixMe, incidentId: $TSFixMe, alertId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Enterprise Alert API', function(this: $TSFixMe) {
    this.timeout(30000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createEnterpriseUser(request, userData.user, function(err: $TSFixMe, res: $TSFixMe) {
                const project = res.body.project;
                projectId = project._id;

                ComponentModel.create({ name: 'New Component' }).then(
                    component => {
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
                                    .post(`/monitor/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send({
                                        name: 'New Monitor',
                                        type: 'url',
                                        data: {
                                            url: 'http://www.tests.org',
                                        },
                                        componentId: component._id,
                                    })
                                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                                        monitorId = res.body._id;
                                        incidentData.monitors = [monitorId];
                                        done();
                                    });
                            });
                    }
                );
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
        await IncidentService.hardDeleteBy({ _id: incidentId });
        await AlertService.hardDeleteBy({ _id: alertId });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create alert with valid details for project with no billing plan', function(done: $TSFixMe) {
        const authorization = `Basic ${token}`;
        request
            .post(`/incident/${projectId}/create-incident`)
            .set('Authorization', authorization)
            .send(incidentData)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                incidentId = res.body._id;
                request
                    .post(`/alert/${projectId}`)
                    .set('Authorization', authorization)
                    .send({
                        monitorId,
                        alertVia: 'email',
                        incidentId,
                        eventType: 'identified',
                    })
                    .end(function(err: $TSFixMe, res: $TSFixMe) {
                        alertId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        done();
                    });
            });
    });
});
