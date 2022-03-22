process.env['PORT'] = 3424;
const expect = require('chai').expect;
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

describe('Version API', function () {
    this.timeout(20000);

    it('should get the current helm-chart version', function (done: $TSFixMe) {
        request
            .get('/helm-chart/version')
            .end(function (err: $TSFixMe, res: Response) {
                expect(res).to.have.status(200);
                expect(res.body.helmChartVersion).to.be.equal(
                    process.env['npm_package_version']
                );
                done();
            });
    });
});
