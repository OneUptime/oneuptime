/* eslint-disable no-undef */

process.env.PORT = 3021;
const expect = require('chai').expect;
const {
    validLicense,
    invalidLicense,
    expiredLicense,
} = require('./data/license');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');

const request = chai.request.agent(app);
const AirtableService = require('../src/services/airtableService');

const tableName = 'License';
const email = 'license@hackerbay.io';
let validLicenseId, expiredLicenseId;

describe('License API', function() {
    this.timeout(20000);

    before(async () => {
        const licenses = await AirtableService.create({
            tableName,
            fields: [{ fields: validLicense }, { fields: expiredLicense }],
        });
        validLicenseId = licenses[0].id;
        expiredLicenseId = licenses[1].id;
    });

    after(async () => {
        await AirtableService.delete({
            tableName,
            id: [validLicenseId, expiredLicenseId],
        });
    });

    it('should confirm valid license', done => {
        request
            .post('/license')
            .send({
                license: validLicense['License Key'],
                email,
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).have.property('token');
                done();
            });
    });

    it('should not confirm invalid license', done => {
        request
            .post('/license')
            .send({
                license: invalidLicense['License Key'],
                email,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('Invalid License');
                done();
            });
    });

    it('should not confirm expired license', done => {
        request
            .post('/license')
            .send({
                license: expiredLicense['License Key'],
                email,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('License Expired');
                done();
            });
    });

    it('should not confirm valid license for missing details', done => {
        request
            .post('/license')
            .send({
                license: validLicense['License Key'],
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('Email must be present.');
                done();
            });
    });
});
