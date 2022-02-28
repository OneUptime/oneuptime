const expect = require('chai').expect;
import chai from 'chai';
chai.use(require('chai-http'));
require('dotenv').config();
const requests: $TSFixMe = [];
let app, request: $TSFixMe, sandbox: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('API limit rate', function() {
    this.timeout(10000);
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done: $TSFixMe) {
        // @ts-expect-error ts-migrate(1232) FIXME: An import declaration can only be used in a namesp... Remove this comment to see the full error message
        import sinon from 'sinon';
        sandbox = sinon.createSandbox();
        sandbox
            .stub(process.env, 'RATE_LIMITTER_TIME_PERIOD_IN_MS')
            .value('5000');
        sandbox.stub(process.env, 'RATE_LIMITTER_REQUEST_LIMIT').value('3');
        sandbox.stub(process.env, 'RATE_LIMITTER_ENABLED').value('true');
        require('../server').close();
        delete require.cache[require.resolve('../server')];
        app = require('../server');
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
        request = chai.request.agent(app);
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get too many requests response after 3 requests', async function() {
        for (let i = 1; i <= 3; i++) {
            requests.push(request.get('/'));
        }
        await Promise.all(requests);
        const response = await request.get('/');
        expect(response.status).to.be.equal(429);
    });
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(function(done: $TSFixMe) {
        sandbox.restore();
        done();
    });
});
