const chai = require('chai')
const should = chai.should()
const expect = chai.expect

const logger = require('../src/logger');
import Logger from '../src/logger';
// const Logger = logger.Logger;

describe('Logger', function() {

    it('should request for application log key', function(){
        const firstLog = new Logger('53cb6b9b4f4ddef1ad47f943','');
        firstLog.log('here').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal('Application Log Key is required.');
        })
    })
    it('should request for content', function(){
        const firstLog = new Logger('53cb6b9b4f4ddef1ad47f943','key');
        firstLog.log('').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal('Content to be logged is required.');
        })
    })
    it('should return invalid application log', function(){
        const firstLog = new Logger('53cb6b9b4f4ddef1ad47f943','key');
        firstLog.log('content').catch(error => {
            expect(error.response.status).to.equal(400);
            expect(error.response.data.message).to.equal('Application Log does not exist.');
        })
    })
    it('should return a valid logged item of type string', function(){
        const validLog = new Logger('5edf4d94a68af8016be57931','2003e4d7-ebe9-4e16-b254-b3ed4b75575a');
        const logMessage = 'This is a simple log';
        validLog.log(logMessage).then(response => {
            expect(response.status).to.equal(200);
            expect(response.data).to.be.an('object')
            expect(response.data.content).to.be.a('string')
            expect(response.data).to.include({content:logMessage})            
        })
    })
    it('should return a valid logged item of type object', function(){
        const validLog = new Logger('5edf4d94a68af8016be57931','2003e4d7-ebe9-4e16-b254-b3ed4b75575a');
        const logMessage = { message: 'This is a simple log', user: { name: 'Jon', email: 'accurate@y.co.uk'}};
        validLog.log(logMessage).then(response => {
            expect(response.status).to.equal(200);
            expect(response.data).to.be.an('object')
            expect(response.data.content).to.be.an('object')
            expect(response.data.content).to.include({ message: logMessage.message})  
            expect(response.data.content.user).to.include({ name: logMessage.user.name})  
            expect(response.data.content.user).to.include({ email: logMessage.user.email})         
        })
    })
    
})