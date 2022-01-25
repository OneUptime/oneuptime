process.env.PORT = 3002;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createEnterpriseUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');

let token, projectId, newProjectId;

describe('Enterprise Project API', function() {
    this.timeout(30000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            createEnterpriseUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;

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

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, newProjectId] },
        });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
    });

    it('should create a project when `planId` is not given', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Test Project',
            })
            .end(function(err, res) {
                newProjectId = res.body._id;
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete a project', done => {
        const authorization = `Basic ${token}`;
        request
            .delete(`/project/${projectId}/deleteProject`)
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should restore a deleted project', done => {
        const authorization = `Basic ${token}`;
        request
            .put(`/project/${projectId}/restoreProject`)
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                done();
            });
    });
});
