let chai = require('chai');
let chaiHttp = require('chai-http');
let server = require('../server');
chai.use(chaiHttp);
let should = require('should');
let { validLicense, invalidLicense, expiredLicense, email } = require('./utils/licenseUtil')



/*
  * Test the /license route
  */
describe('Test for valid License', function(){
    this.timeout(4000)
    it('it should confirm if license is valid and return null', (done) => {
        let userDetails = { license: validLicense,
                            email 
                        }

        chai.request(server)
            .post('/license')
            .send(userDetails)
            .end((err, res) => {
                if(err) done(err)

                    res.body.should.have.property('token');   
                done();
            });
        });
});

describe('Test for invalid License', function(){
    this.timeout(4000)
    it('it should check if license is invalid and return a token', (done) => {
        let userDetails = { license: invalidLicense, 
                            email 
                        }

        chai.request(server)
            .post('/license')
            .send(userDetails)
            .end((err, res) => {
                if(err) done(err)
                    res.body.should.have.property('message').eql('Not Found'); 
                done();
            });
        });
});

describe('Test for expired License', function(){
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
                    res.body.should.have.property('message').eql('License Expired'); 
                done();
            });
        });
});