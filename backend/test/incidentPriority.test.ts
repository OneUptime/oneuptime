process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import IncidentSettings from '../backend/services/incidentSettingsService';
import ProjectService from '../backend/services/projectService';
import VerificationTokenModel from '../backend/models/verificationToken';
import GlobalConfig from './utils/globalConfig';
import AirtableService from '../backend/services/airtableService';

let token: $TSFixMe,
    userId: $TSFixMe,
    projectId: $TSFixMe,
    defaultIncidentPriorityId: $TSFixMe,
    newIncidentPriorityId: $TSFixMe;

describe('Incident Priority API', function() {
    this.timeout(500000);

    before(function(done: $TSFixMe) {
        this.timeout(90000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, userData.user, function(
                err: $TSFixMe,
                res: $TSFixMe
            ) {
                projectId = res.body.project._id;
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
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await IncidentSettings.hardDeleteBy({ projectId: projectId });
        await UserService.hardDeleteBy({ _id: userId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('Should return the list of the available variables.', async () => {
        const authorization = `Basic ${token}`;
        const res = await request
            .get(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.eql(2);
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.eql(2);
        expect(res.body.data[0]).to.have.property('_id');
        defaultIncidentPriorityId = res.body.data[0]._id;
        expect(res.body.data[0]).to.have.property('name');
        expect(res.body.data[0].name).to.eql('High');
        expect(res.body.data[1]).to.have.property('name');
        expect(res.body.data[1].name).to.eql('Low');
    });

    it('Should not remove the default incident priority.', (done: $TSFixMe) => {
        const authorization = `Basic ${token}`;
        request
            .delete(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization)
            .send({ _id: defaultIncidentPriorityId })
            .end((error: $TSFixMe, res: $TSFixMe) => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('Should create a new incident priority.', async () => {
        const authorization = `Basic ${token}`;
        let res = await request
            .post(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Intermediate',
                color: {
                    r: 255,
                    g: 255,
                    b: 0,
                    a: 1,
                },
            });
        expect(res).to.have.status(200);
        res = await request
            .get(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.eql(3);
        expect(res.body.data).to.be.an('array');
        expect(res.body.data.length).to.eql(3);
        expect(res.body.data[2]).to.have.property('_id');
        newIncidentPriorityId = res.body.data[2]._id;
        expect(res.body.data[2]).to.have.property('name');
        expect(res.body.data[2].name).to.eql('Intermediate');
    });

    it('Should update incident priority.', async () => {
        const newIncidentPriorityName = 'Intermediate Updated';
        const authorization = `Basic ${token}`;

        let res = await request
            .put(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: newIncidentPriorityId,
                name: newIncidentPriorityName,
                color: {
                    r: 255,
                    g: 255,
                    b: 0,
                    a: 1,
                },
            });
        expect(res).to.have.status(200);

        res = await request
            .get(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.eql(3);
        expect(res.body.data[2].name).to.eql(newIncidentPriorityName);
    });

    it('Should delete incident priority.', async () => {
        const authorization = `Basic ${token}`;
        let res = await request
            .delete(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization)
            .send({ _id: newIncidentPriorityId });
        expect(res).to.have.status(200);

        res = await request
            .get(`/incidentPriorities/${projectId}`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.eql(2);
    });
});
