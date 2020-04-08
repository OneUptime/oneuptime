/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const data = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createEnterpriseUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');
const { testemail } = require('./utils/config');
const GlobalConfigService = require('../backend/services/globalConfigService');


let projectId, airtableId, jwtToken, refreshToken, user;

describe('Email SMTP Api Test', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(() => {
            createEnterpriseUser(request, data.user, async (err, res) => {
                // have access to the tokens and user on creation of account
                const project = res.body.project;
                projectId = project._id;
                airtableId = res.body.airtableId;
                jwtToken = res.body.tokens.jwtAccessToken;
                refreshToken = res.body.tokens.jwtRefreshToken;

                // make created user master admin
                user = await UserService.updateBy(
                    { email: data.user.email },
                    { role: 'master-admin' }
                );

                done();
            });
        });
    });

    after(async () => {
        await GlobalConfig.removeTestConfig();
        await UserService.hardDeleteBy({
            email: {
                $in: [data.user.email],
            },
        });
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId] },
        });
        await AirtableService.deleteUser(airtableId);
    });

    it('should confirm that `master-admin` exists', done => {
        request.get('/user/masterAdminExists').end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).have.property('result');
            expect(res.body.result).to.eql(true);
            done();
        });
    });

    it('should send test smtp email to the provided email address', done => {
        let authorization = `Basic ${jwtToken}`;
        GlobalConfigService.findOneBy({ name: 'smtp' }).then(({ value }) => {

            const payload = {
                user: value.email,
                pass: value.password,
                host: value['smtp-server'],
                port: value['smtp-port'],
                from: value['from-name'],
                secure: value['smtp-secure'],
                email: testemail
            }

            request.post('/emailSmtp/test')
                .set('Authorization', authorization)
                .send(payload)
                .end(function (err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    done();
                });
        })
    });

    it('should not send test smtp email when user or pass is not valid', done => {
        let authorization = `Basic ${jwtToken}`;
        GlobalConfigService.findOneBy({ name: 'smtp' }).then(({ value }) => {
            value.email = 'randomemail@gmail.com';
            const payload = {
                user: value.email,
                pass: value.password,
                host: value['smtp-server'],
                port: value['smtp-port'],
                from: value['from-name'],
                secure: value['smtp-secure'],
                email: testemail
            }

            request.post('/emailSmtp/test')
                .set('Authorization', authorization)
                .send(payload)
                .end(function (err, res) {
                    expect(res).to.have.status(400);
                    done();
                });
        })
    });

    it('should not send test smtp email when host or port is invalid', done => {
        let authorization = `Basic ${jwtToken}`;
        GlobalConfigService.findOneBy({ name: 'smtp' }).then(({ value }) => {
            value['smtp-server'] = 'random.host';
            const payload = {
                user: value.email,
                pass: value.password,
                host: value['smtp-server'],
                port: value['smtp-port'],
                from: value['from-name'],
                secure: value['smtp-secure'],
                email: testemail
            }

            request.post('/emailSmtp/test')
                .set('Authorization', authorization)
                .send(payload)
                .end(function (err, res) {
                    expect(res).to.have.status(400);
                    done();
                });
        })
    })
});
