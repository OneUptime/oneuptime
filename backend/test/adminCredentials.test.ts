import userData from './data/user';

process.env.PORT = 3020;
process.env.ADMIN_EMAIL = userData.adminUser.email.toLowerCase();
process.env.ADMIN_PASSWORD = userData.adminUser.password;
import chai from 'chai';
const expect = require('chai').expect;
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';
import AuditLogsService from '../backend/services/auditLogsService';
import UserService from '../backend/services/userService';
import AirtableService from '../backend/services/airtableService';

let token;

describe('Admin process.env login API', function () {
    this.timeout(30000);

    before(async function () {
        this.timeout(40000);
        await UserService.hardDeleteBy({});
        await GlobalConfig.initTestConfig();
    });

    after(async function () {
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.removeTestConfig();
        await AuditLogsService.hardDeleteBy({});
    });

    it('should NOT log in the admin user with invalid credentials', function (done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD + '1',
            })
            .end(function (err: $TSFixMe, req: Response) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should log in the admin user', function (done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD,
            })
            .end(function (err: $TSFixMe, req: Response) {
                token = res.body.tokens.jwtAccessToken;
                if (token) {
                    done();
                } else {
                    done('No token found');
                }
            });
    });
});
