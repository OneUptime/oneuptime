process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
chai.use(require('chai-http'));
import app from '../server'
import GlobalConfig from './utils/globalConfig'
const request = chai.request.agent(app);
import { createEnterpriseUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import ComponentService from '../backend/services/componentService'

let token, projectId, newProjectId, componentId;

describe('Enterprise Component API', function() {
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
        await ComponentService.hardDeleteBy({ _id: componentId });
        await UserService.hardDeleteBy({
            email: userData.user.email.toLowerCase(),
        });
    });

    it('should create a new component for project with no billing plan', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post('/project/create')
            .set('Authorization', authorization)
            .send({
                projectName: 'Test Project',
            })
            .end(function(err, res) {
                newProjectId = res.body._id;
                request
                    .post(`/component/${newProjectId}`)
                    .set('Authorization', authorization)
                    .send({
                        name: 'New Component',
                    })
                    .end(function(err, res) {
                        componentId = res.body._id;
                        expect(res).to.have.status(200);
                        expect(res.body.name).to.be.equal('New Component');
                        done();
                    });
            });
    });
});
