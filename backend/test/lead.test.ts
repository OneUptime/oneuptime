// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chai-http);
import app from '../server'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
import GlobalConfig from './utils/globalConfig'
import leadService from '../backend/services/leadService'
import EmailStatusService from '../backend/services/emailStatusService'

const leadData = {
    'csrf-token': '1',
    analytics_event_id: '',
    fullname: 'John Smith',
    email: 'testmail@oneuptime.com',
    website: 'oneuptime.com',
    country: 'IN',
    volume: '{"index":0,"total":6,"text":"$75,000 or less","lower_bound":0}',
    message: 'Testing',
    type: 'demo',
};
const selectEmailStatus =
    'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Lead API', function(this: $TSFixMe) {
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function(this: $TSFixMe) {
        this.timeout(30000);
        await GlobalConfig.initTestConfig();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add lead when requested for type demo or whitepaper', function(done: $TSFixMe) {
        request
            .post('/lead')
            .send(leadData)
            .end(function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                leadService.hardDeleteBy({ _id: res.body._id });
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add lead when requested for type demo and check the sent message', function(this: $TSFixMe, done: $TSFixMe) {
        this.timeout(60000);
        request
            .post('/lead')
            .send(leadData)
            .end(async function(err: $TSFixMe, res: $TSFixMe) {
                expect(res).to.have.status(200);
                leadService.hardDeleteBy({ _id: res.body._id });
                const emailStatuses = await EmailStatusService.findBy({
                    query: {},
                    select: selectEmailStatus,
                });
                if (emailStatuses[0].subject.includes('New Lead')) {
                    expect(emailStatuses[0].subject).to.equal('New Lead Added');
                    expect(emailStatuses[0].status).to.equal(
                        'Email not enabled.'
                    );
                    expect(emailStatuses[1].subject).to.equal(
                        'Thank you for your demo request.'
                    );
                    expect(emailStatuses[1].status).to.equal(
                        'Email not enabled.'
                    );
                } else {
                    expect(emailStatuses[0].subject).to.equal(
                        'Thank you for your demo request.'
                    );
                    expect(emailStatuses[0].status).to.equal(
                        'Email not enabled.'
                    );
                    expect(emailStatuses[1].subject).to.equal('New Lead Added');
                    expect(emailStatuses[1].status).to.equal(
                        'Email not enabled.'
                    );
                }

                done();
            });
    });
});
