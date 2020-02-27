/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const moment = require('moment');

const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');

const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const IncidentService = require('../backend/services/incidentService');
const MonitorService = require('../backend/services/monitorService');
const NotificationService = require('../backend/services/notificationService');
const AirtableService = require('../backend/services/airtableService');

const VerificationTokenModel = require('../backend/models/verificationToken');

let token, userId, airtableId, projectId, monitorId;
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
        createUser(request, userData.user, function(err, res) {
            const project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            airtableId = res.body.airtableId;

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
                                request
                                    .post(`/monitor/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send(monitor)
                                    .end(function(err, res) {
                                        monitorId = res.body._id;
                                        done();
                                    });
                            });
                    });
            });
        });
    });

    after(async function() {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteUser(airtableId);
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
