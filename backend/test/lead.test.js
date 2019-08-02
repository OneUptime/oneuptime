process.env.PORT = 3020;
var expect = require('chai').expect;
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');

var request = chai.request.agent(app);
var leadService = require('../backend/services/leadService');
var { imap, openBox, signUpEmailContent } = require('./utils/mail');
var mailParser = require('mailparser').simpleParser;


var textAsHtml, leadData = {
    'csrf-token': '1',
    analytics_event_id: '',
    fullname: 'Olalekan Ayodele',
    email: 'noreply@fyipe.com',
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
            leadService.hardDeleteBy({_id: res.body._id});
            done();
        });
    });
    it('should add lead when requested for type demo and check the sent message', function (done) {
        request.post('/lead').send(leadData).end(function (err, res) {
            expect(res).to.have.status(200);
            leadService.hardDeleteBy({_id: res.body._id});
            imap.once('ready', function () {
                openBox(function (err) {
                    if (err) throw err;
                    var f = imap.seq.fetch('1:1', {
                        bodies: [''],
                        struct: true
                    });
                    f.on('message', function (msg) {
                        msg.on('body', function (stream) {
                            mailParser(stream, {}, function (err, parsedMail) {
                                textAsHtml = parsedMail.text;
                                expect(textAsHtml).to.be.equal(signUpEmailContent);
                                done(); 
                            });
                        });
                    });
                    f.once('end', function () {
                        imap.end();
                    });
                });
            });
            imap.connect();
        });
    });
});