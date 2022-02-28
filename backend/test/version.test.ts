// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Version API', function() {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get the current server version', function(done: $TSFixMe) {
        request.get('/version').end(function(err: $TSFixMe, res: $TSFixMe) {
            expect(res).to.have.status(200);
            expect(res.body.server).to.be.equal(
                process.env.npm_package_version
            );
            done();
        });
    });
});
