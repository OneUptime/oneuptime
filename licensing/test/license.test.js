let chai = require('chai');
let chaiHttp = require('chai-http');
let server = require('../server');
chai.use(chaiHttp);
let should = require('should');
let { license,email } = require('./utils/licenseUtil')



/*
  * Test the /license route
  */
 describe('License confirmation endpoint test', function(){
    this.timeout(3000)
    it('it should confirm if license exists and return a token', (done) => {
        let userDetails = { license, email }
        console.log(userDetails)

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
