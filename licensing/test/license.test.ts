// @ts-expect-error ts-migrate(2322) FIXME: Type '3021' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3021;
const expect = require('chai').expect;
const {
    validLicense,
    invalidLicense,
    expiredLicense,
} = require('./data/license');
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chai-http);
import app from '../server'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import AirtableService from '../src/services/airtableService'

const tableName = 'License';
const email = 'license@hackerbay.io';
let validLicenseId: $TSFixMe, expiredLicenseId: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('License API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async () => {
        const licenses = await AirtableService.create({
            tableName,
            fields: [{ fields: validLicense }, { fields: expiredLicense }],
        });
        validLicenseId = licenses[0].id;
        expiredLicenseId = licenses[1].id;
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async () => {
        await AirtableService.delete({
            tableName,
            id: [validLicenseId, expiredLicenseId],
        });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should confirm valid license', (done: $TSFixMe) => {
        request
            .post('/license/validate')
            .send({
                license: validLicense['License Key'],
                email,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                expect(res.body).have.property('token');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not confirm invalid license', (done: $TSFixMe) => {
        request
            .post('/license/validate')
            .send({
                license: invalidLicense['License Key'],
                email,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('Invalid License');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not confirm expired license', (done: $TSFixMe) => {
        request
            .post('/license/validate')
            .send({
                license: expiredLicense['License Key'],
                email,
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('License Expired');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not confirm valid license for missing details', (done: $TSFixMe) => {
        request
            .post('/license/validate')
            .send({
                license: validLicense['License Key'],
            })
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.equal('Email must be present.');
                done();
            });
    });
});
