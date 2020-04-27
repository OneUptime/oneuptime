/* eslint-disable no-undef */

const userData = require('./data/user');
process.env.PORT = 3020;
process.env.ADMIN_EMAIL = userData.adminUser.email;
process.env.ADMIN_PASSWORD = userData.adminUser.password;
const chai = require('chai');
const expect = require('chai').expect;

const app = require('../server');
chai.use(require('chai-http'));
const request = chai.request.agent(app);
const GlobalConfig = require('./utils/globalConfig');
const AuditLogsService = require('../backend/services/auditLogsService');
const UserService = require('../backend/services/userService');
const AirtableService = require('../backend/services/airtableService');

let token;

describe('Admin process.env login API', function() {
    this.timeout(30000);

    before(async function() {
        this.timeout(40000);
        await UserService.hardDeleteBy({});
        await GlobalConfig.initTestConfig();
    });

    after(async function() {
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.removeTestConfig();
        await AuditLogsService.hardDeleteBy({});
    });

    it('should NOT log in the admin user with invalid credentials', function(done) {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD + '1',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should log in the admin user', function(done) {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD,
            })
            .end(function(err, res) {
                token = res.body.tokens.jwtAccessToken;
                if (token) {
                    done();
                } else {
                    done('No token found');
                }
            });
    });
});
