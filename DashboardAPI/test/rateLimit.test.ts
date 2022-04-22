import chai, { expect } from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import dotenv from 'dotenv';
dotenv.config();
const requests: $TSFixMe = [];
let app: $TSFixMe, request: $TSFixMe, sandbox: $TSFixMe;

describe('API limit rate', function (): void {
    this.timeout(10000);

    before((done: $TSFixMe): void => {
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

        request = chai.request.agent(app);
        done();
    });

    it('should get too many requests response after 3 requests', async (): void => {
        for (let i: $TSFixMe = 1; i <= 3; i++) {
            requests.push(request.get('/'));
        }
        await Promise.all(requests);
        const response: $TSFixMe = await request.get('/');
        expect(response.status).to.be.equal(429);
    });

    after((done: $TSFixMe): void => {
        sandbox.restore();
        done();
    });
});
