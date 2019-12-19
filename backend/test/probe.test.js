process.env.PORT = 3020;
process.env.REDIS_HOST = 'redis.default.svc.cluster.local';
process.env.REDIS_PORT = 6379;
var expect = require('chai').expect;
var chai = require('chai');
chai.use(require('chai-http'));
chai.use(require('chai-subset'));
var app = require('../server');

var request = chai.request.agent(app);
var clusterKey = require('../backend/config/keys').clusterKey;
var ProbeService = require('../backend/services/probeService');
var probeId;

describe('Probe API', function () {
    this.timeout(20000);

    after(async function () {
        await ProbeService.hardDeleteBy({_id: probeId});
    });

    it('should add a probe by admin', function (done) {
        request.post('/probe/').send({
            probeName: 'New Probe',
            clusterKey:clusterKey,
        }).end(function (err, res) {
            probeId = res.body._id;
            expect(res).to.have.status(200);
            expect(res.body.probeName).to.be.equal('New Probe');
            done();
        });
    });

    it('should not add a probe if not admin', function (done) {
        request.post('/probe/').send({
            probeName: 'New Probe',
            clusterKey:'',
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should reject a probe if same name already exists', function (done) {
        request.post('/probe/').send({
            probeName: 'New Probe',
            clusterKey:clusterKey,
        }).end(function (err, res) {
            expect(res).to.have.status(400);
            done();
        });
    });

    it('should get a list of probe by admin', function (done) {
        request.get('/probe/').send({
            clusterKey:clusterKey,
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });

    it('should delete a probe by admin', function (done) {
        request.delete(`/probe/${probeId}`).send({
            clusterKey:clusterKey,
        }).end(function (err, res) {
            expect(res).to.have.status(200);
            done();
        });
    });
});
