/* eslint-disable linebreak-style */
process.env.PORT = 3020;
process.env.SOCKET_PORT = 3021;
var expect = require('chai').expect;
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);

describe('Version API', function () {
    this.timeout(20000);

    it('should get the current server version', function (done) {
        request.get('/version').end(function (err, res) {
            expect(res).to.have.status(200);
            expect(res.body.server).to.be.equal(process.env.npm_package_version);
            done();
        });
    });
});