let chai = require('chai');
let chaiHttp = require('chai-http');
let server = require('../server');
chai.use(chaiHttp);
let should = require('should');
let { validLicense, invalidLicense, expiredLicense, email, validDate, expiredDate } = require('./utils/licenseUtil')
// const Airtable = require('airtable')
// const AirtableApiKey = process.env['AIRTABLE_API_KEY'];
// const AirtableBaseId = process.env['AIRTABLE_BASE_ID'];
// const base = new Airtable({apiKey: AirtableApiKey}).base(AirtableBaseId);
const airtableService = require('../src/services/airtableService')


//TEST FOR VALID LICENSE
describe('Test for valid License', function(){
    this.timeout(4000)
    var id 
    
    airtableService.base('License').create([
    {
        "fields": {
        "License Key": validLicense,
        "Expires": validDate
        }
    }], function(err, records) {
        if (err) {
            return;
    }
    records.forEach(function (record) {
        id = record.id;
        });
    });

    it('it should confirm if license is valid and return token', (done) => {
        let userDetails = { license: validLicense,
                            email 
                        }

        chai.request(server)
            .post('/license')
            .send(userDetails)
            .end((err, res) => {
                if(err) done(err)
                    res.should.have.property('status', 200)
                    res.body.should.have.property('token');   
                done();
            });
        });


    afterEach('ensuring everything is cleaned up', (done)=>{
        airtableService.base('License').destroy(id, function(err, deletedRecords) {
            if (err) {
              return;
            }
          });
        done();
    });
});

//TEST FOR INVALID LICENSE
describe('Test for invalid License', function(){
    this.timeout(4000)
    
    it('it should check if license is invalid and return a not found response', (done) => {
        let userDetails = { license: invalidLicense, 
                            email 
                        }

        chai.request(server)
            .post('/license')
            .send(userDetails)
            .end((err, res) => {
                if(err) done(err)
                    res.should.have.property('status', 400)
                    res.body.should.have.property('message').eql('Not Found'); 
                done();
            });
        });
});

//TEST FOR EXPIRED LICENSE
describe('Test for expired License', function(){
    var id 
    
    airtableService.base('License').create([
    {
        "fields": {
        "License Key": expiredLicense,
        "Expires": expiredDate
        }
    }], function(err, records) {
        if (err) {
            return;
    }
    records.forEach(function (record) {
        id = record.id;
        });
    });

    this.timeout(4000)
    it('it should check if license has expired', (done) => {
        let userDetails = { license: expiredLicense, 
                            email 
                        }

        chai.request(server)
            .post('/license')
            .send(userDetails)
            .end((err, res) => {
                if(err) done(err)
                    res.should.have.property('status', 400)
                    res.body.should.have.property('message').eql('License Expired'); 
                done();
            });
        });

    afterEach('ensuring everything is cleaned up', (done)=>{
        airtableService.base('License').destroy(id, function(err, deletedRecords) {
            if (err) {
                return;
            }
            });
        done();
    });
});

//TEST FOR MISSING PAYLOAD DATA
describe('Test for missing payload parameter', function(){
    this.timeout(4000)
    
    it('it should check if any parameter is missing in the payload', (done) => {
        let userDetails = { email }

        chai.request(server)
            .post('/license')
            .send(userDetails)
            .end((err, res) => {
                if(err) done(err)
                    res.should.have.property('status', 400)
                    res.body.should.have.property('message').eql('Please provide your license'); 
                done();
            });
        });
});