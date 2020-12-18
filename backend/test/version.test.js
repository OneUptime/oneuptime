/* eslint-disable linebreak-style */
process.env.PORT = 3020;
const expect = require('chai').expect;
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const request = chai.request.agent(app);

const dashboardVersion = require('../../dashboard/package.json').version;
const helmVersion = require('../../helm-chart/package.json').version;
const docsVersion = require('../../api-docs/package.json').version;

describe('Version API', function() {
    this.timeout(20000);

    it('should get the current server version', function(done) {
        request.get('/version').end(function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body.server).to.be.equal(
                process.env.npm_package_version
            );
            done();
        });
    });

    it('should get the current dashboard version', function(done) {
        request.get('/version').end(function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body.dashboard).to.be.equal(dashboardVersion);
            done();
        });
    });

    it('should get the current docs version', function(done) {
        request.get('/version').end(function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body.docs).to.be.equal(docsVersion);
            done();
        });
    });

    it('should get the current helm chart version', function(done) {
        request.get('/version').end(function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body.helm).to.be.equal(helmVersion);
            done();
        });
    });
});
