process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'
import moment from 'moment'
import GlobalConfig from './utils/globalConfig'

const request = chai.request.agent(app);
import { createUser } from './utils/userSignUp'

import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import IncidentService from '../backend/services/incidentService'
import MonitorService from '../backend/services/monitorService'
import NotificationService from '../backend/services/notificationService'
import AirtableService from '../backend/services/airtableService'

import VerificationTokenModel from '../backend/models/verificationToken'
import ComponentModel from '../backend/models/component'

let token, userId, projectId, monitorId;
const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};
const endDate = moment().format('YYYY-MM-DD');
const startDate = moment()
    .subtract(7, 'd')
    .format('YYYY-MM-DD');
const filter = 'month';

describe('Reports API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    err,
                    verificationToken
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function() {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
                                    ComponentModel.create({
                                        name: 'Test Component',
                                    }).then(component => {
                                        request
                                            .post(`/monitor/${projectId}`)
                                            .set('Authorization', authorization)
                                            .send({
                                                ...monitor,
                                                componentId: component._id,
                                            })
                                            .end(function(err, res) {
                                                monitorId = res.body._id;
                                                done();
                                            });
                                    });
                                });
                        });
                });
            });
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email.toLowerCase(),
                    userData.newUser.email.toLowerCase(),
                    userData.anotherUser.email.toLowerCase(),
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should return list of most active members', done => {
        const authorization = `Basic ${token}`;

        request
            .get(
                `/reports/${projectId}/active-members?startDate=${startDate}&&endDate=${endDate}&&skip=0&&limit=10`
            )
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should return list of most active monitors', done => {
        const authorization = `Basic ${token}`;
        request
            .get(
                `/reports/${projectId}/active-monitors?startDate=${startDate}&&endDate=${endDate}&&skip=0&&limit=10`
            )
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should return average resolved incidents time', done => {
        const authorization = `Basic ${token}`;
        request
            .get(
                `/reports/${projectId}/average-resolved?startDate=${startDate}&&endDate=${endDate}&&filter=${filter}`
            )
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should return number of incidents', done => {
        const authorization = `Basic ${token}`;
        request
            .get(
                `/reports/${projectId}/incidents?startDate=${startDate}&&endDate=${endDate}&&filter=${filter}`
            )
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });
});
