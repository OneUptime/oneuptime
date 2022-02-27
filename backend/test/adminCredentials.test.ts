import userData from './data/user'
// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
process.env.ADMIN_EMAIL = userData.adminUser.email.toLowerCase();
process.env.ADMIN_PASSWORD = userData.adminUser.password;
import chai from 'chai'
const expect = require('chai').expect;
..
import app from '../server'
chai.use(require('chai-http'));
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig'
import AuditLogsService from '../backend/services/auditLogsService'
import UserService from '../backend/services/userService'
import AirtableService from '../backend/services/airtableService'

let token;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Admin process.env login API', function(this: $TSFixMe) {
    this.timeout(30000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function(this: $TSFixMe) {
        this.timeout(40000);
        await UserService.hardDeleteBy({});
        await GlobalConfig.initTestConfig();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await UserService.hardDeleteBy({});
        await AirtableService.deleteAll({ tableName: 'User' });
        await GlobalConfig.removeTestConfig();
        await AuditLogsService.hardDeleteBy({});
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should NOT log in the admin user with invalid credentials', function(done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD + '1',
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should log in the admin user', function(done: $TSFixMe) {
        request
            .post('/user/login')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                token = res.body.tokens.jwtAccessToken;
                if (token) {
                    done();
                } else {
                    done('No token found');
                }
            });
    });
});
