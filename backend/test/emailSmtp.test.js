/* eslint-disable no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const data = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');
const { testemail } = require('./utils/config');
const GlobalConfigService = require('../backend/services/globalConfigService');
const VerificationTokenModel = require('../backend/models/verificationToken');
const smtpCredential = require('./data/smtpCredential');

let projectId, airtableId, jwtToken, emailSmtpId;

describe('Email SMTP Api Test', function() {
    this.timeout(200000);

    before(function(done) {
        this.timeout(400000);
        GlobalConfig.initTestConfig().then(function() {
            createUser(request, data.user, function(err, res) {
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
                        .end(async () => {
                            // make created user master admin
                            await UserService.updateBy(
                                { _id: userId },
                                { role: 'master-admin' }
                            );

                            request
                                .post('/user/login')
                                .send({
                                    email: data.user.email,
                                    password: data.user.password,
                                })
                                .end(function(err, res) {
                                    jwtToken = res.body.tokens.jwtAccessToken;
                                    done();
                                });
                        });
                });
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
        const authorization = `Basic ${jwtToken}`;
        GlobalConfigService.findOneBy({ name: 'smtp' }).then(({ value }) => {
            const payload = {
                user: value.email,
                pass: value.password,
                host: value['smtp-server'],
                port: value['smtp-port'],
                from: value['from'],
                name: value['from-name'],
                secure: value['smtp-secure'],
                email: testemail,
            };

            request
                .post('/emailSmtp/test')
                .set('Authorization', authorization)
                .send(payload)
                .end(function(err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    done();
                });
        });
    });

    it('should not send test smtp email when user or pass is not valid', done => {
        const authorization = `Basic ${jwtToken}`;
        GlobalConfigService.findOneBy({ name: 'smtp' }).then(({ value }) => {
            value.email = 'randomemail@gmail.com';
            const payload = {
                user: value.email,
                pass: value.password,
                host: value['smtp-server'],
                port: value['smtp-port'],
                name: value['from-name'],
                from: value['from'],
                secure: value['smtp-secure'],
                email: testemail,
            };

            request
                .post('/emailSmtp/test')
                .set('Authorization', authorization)
                .send(payload)
                .end(function(err, res) {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    it('should not send test smtp email when host or port is invalid', done => {
        const authorization = `Basic ${jwtToken}`;
        GlobalConfigService.findOneBy({ name: 'smtp' }).then(({ value }) => {
            value['smtp-server'] = 'random.host';
            const payload = {
                user: value.email,
                pass: value.password,
                host: value['smtp-server'],
                port: value['smtp-port'],
                name: value['from-name'],
                from: value['from'],
                secure: value['smtp-secure'],
                email: testemail,
            };

            request
                .post('/emailSmtp/test')
                .set('Authorization', authorization)
                .send(payload)
                .end(function(err, res) {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    it('should save custom SMTP settings', done => {
        const authorization = `Basic ${jwtToken}`;
        const data = {
            ...smtpCredential,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                emailSmtpId = res.body._id;
                expect(res).to.have.status(200);
                expect(data.user).to.be.equal(res.body.user);
                done();
            });
    });

    it('should not save custom SMTP settings if user name is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let user;
        const data = {
            ...smtpCredential,
            user,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('User Name is required.');
                done();
            });
    });

    it('should not save custom SMTP settings if password is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let pass;
        const data = {
            ...smtpCredential,
            pass,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Password is required.');
                done();
            });
    });

    it('should not save custom SMTP settings if host is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let host;
        const data = {
            ...smtpCredential,
            host,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('host is required.');
                done();
            });
    });

    it('should not save custom SMTP settings if port is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let port;
        const data = {
            ...smtpCredential,
            port,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('port is required.');
                done();
            });
    });

    it('should not save custom SMTP settings if from is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let from;
        const data = {
            ...smtpCredential,
            from,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('from is required.');
                done();
            });
    });

    it('should not save custom SMTP settings if name is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let name;
        const data = {
            ...smtpCredential,
            name,
        };

        request
            .post(`/emailSmtp/${projectId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('name is required.');
                done();
            });
    });

    it('should update a custom SMTP settings', done => {
        const authorization = `Basic ${jwtToken}`;
        const data = { ...smtpCredential, from: 'info@gmail.com' };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body.from).to.be.equal(data.from);
                done();
            });
    });

    it('should not update custom SMTP settings if user name is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let user;
        const data = {
            ...smtpCredential,
            user,
        };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('User Name is required.');
                done();
            });
    });

    it('should not update custom SMTP settings if password is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let pass;
        const data = {
            ...smtpCredential,
            pass,
        };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('Password is required.');
                done();
            });
    });

    it('should not update custom SMTP settings if host is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let host;
        const data = {
            ...smtpCredential,
            host,
        };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('host is required.');
                done();
            });
    });

    it('should not update custom SMTP settings if port is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let port;
        const data = {
            ...smtpCredential,
            port,
        };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('port is required.');
                done();
            });
    });

    it('should not update custom SMTP settings if from is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let from;
        const data = {
            ...smtpCredential,
            from,
        };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('from is required.');
                done();
            });
    });

    it('should not update custom SMTP settings if name is missing', done => {
        const authorization = `Basic ${jwtToken}`;
        let name;
        const data = {
            ...smtpCredential,
            name,
        };

        request
            .put(`/emailSmtp/${projectId}/${emailSmtpId}`)
            .set('Authorization', authorization)
            .send(data)
            .end((err, res) => {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal('name is required.');
                done();
            });
    });
});
