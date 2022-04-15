import userData from './data/user';

process.env.PORT = 3020;
process.env.ADMIN_EMAIL = userData.adminUser.email.toLowerCase();
process.env.ADMIN_PASSWORD = userData.adminUser.password;
import chai from 'chai';
import { expect } from 'chai';
import app from '../server';
import chaihttp from 'chai-http';
chai.use(chaihttp);

const request: $TSFixMe = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig';
import AuditLogsService from '../backend/services/auditLogsService';
import UserService from '../backend/services/userService';
import AirtableService from '../backend/services/airtableService';

let token: $TSFixMe;

describe('Admin process.env login API', function (): void {
    this.timeout(30000);

    before(async function (): void {
        this.timeout(40000);
        await UserService.hardDeleteBy({});
        await GlobalConfig.initTestConfig();
    });

    after(async (): void => {
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.removeTestConfig();
        await AuditLogsService.hardDeleteBy({});
    });

    it('should NOT log in the admin user with invalid credentials', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD + '1',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should log in the admin user', (done: $TSFixMe): void => {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                token = res.body.tokens.jwtAccessToken;
                if (token) {
                    done();
                } else {
                    done('No token found');
                }
            });
    });
});
