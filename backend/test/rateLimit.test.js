const expect = require('chai').expect;
const chai = require('chai');
chai.use(require('chai-http'));
const requests = [];
let _;
let app, request, sandbox;

describe('API limit rate', function () {

    before(function () {
        process.env.PORT = 3020;
        process.env.WINDOWMS = 5000;
        process.env.MAX = 3;
        process.env.RATE_LIMITING_ENABLED = true;

        const sinon = require('sinon');
        sandbox = sinon.createSandbox();
        sandbox.stub(process.env, 'WINDOWMS').value('5000');
        sandbox.stub(process.env, 'MAX').value('3');
        sandbox.stub(process.env, 'RATE_LIMITING_ENABLED').value('true');
        app = require('../server');
        request = chai.request(app);
    });
    this.timeout(10000);

    it('should get too many requests response after 3 requests', async function () {
        for (let i = 1; i <= 3; i++) {
            requests.push(request.get('/'));
        }
        _ = await Promise.all(requests);
        try {
            if (_) {
                const response = await request.get('/');
                expect(response.status).to.be.equal(429);
            }
        } catch (err) {
            expect(err.status).to.be.equal(429);
        }
    });
    after(function () {
        sandbox.restore();
    });
});