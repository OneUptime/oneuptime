process.env['PORT'] = 3020;
import { expect } from 'chai';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';

const request = chai.request.agent(app);

describe('Version API', function (): void {
    this.timeout(20000);

    it('should get the current server version', (done: $TSFixMe): void => {
        request.get('/version').end((err: $TSFixMe, res: $TSFixMe): void => {
            expect(res).to.have.status(200);
            expect(res.body.server).to.be.equal(
                process.env['npm_package_version']
            );
            done();
        });
    });
});
