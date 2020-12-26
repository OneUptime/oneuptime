/* eslint-disable linebreak-style */
process.env.PORT = 1446;
const expect = require('chai').expect;
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const request = chai.request.agent(app);

describe('Version API', function() {
    this.timeout(20000);

    it('should get the current api-docs version', function(done) {
        request.get('/api-docs/version').end(function(err, res) {
            expect(res).to.have.status(200);
            expect(res.body.docsVersion).to.be.equal(
                process.env.npm_package_version
            );
            done();
        });
    });
});
