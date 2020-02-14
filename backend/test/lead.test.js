process.env.PORT = 3020;
var expect = require('chai').expect;
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var leadService = require('../backend/services/leadService');
var EmailStatusService = require('../backend/services/emailStatusService');

var leadData = {
    'csrf-token': '1',
    analytics_event_id: '',
    fullname: 'John Smith',
    email: 'testmail@fyipe.com',
    website: 'fyipe.com',
    country: 'IN',
    volume: '{"index":0,"total":6,"text":"$75,000 or less","lower_bound":0}',
    message: 'Testing',
    type: 'demo'
};

describe('Lead API', function () {
    this.timeout(20000);

    it('should add lead when requested for type demo or whitepaper', function (done) {
        request.post('/lead').send(leadData).end(function (err, res) {
            expect(res).to.have.status(200);
            leadService.hardDeleteBy({ _id: res.body._id });
            done();
        });
    });
    it('should add lead when requested for type demo and check the sent message', function (done) {
        request.post('/lead').send(leadData).end(async function (err, res) {
            expect(res).to.have.status(200);
            leadService.hardDeleteBy({ _id: res.body._id });
            var emailStatuses = await EmailStatusService.findBy({});
            expect(emailStatuses[0].subject).to.equal('Thank you for your demo request.');
            expect(emailStatuses[0].status).to.equal('Success');
            done();
        });
    });
});