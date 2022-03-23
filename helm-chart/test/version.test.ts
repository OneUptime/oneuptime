process.env['PORT'] = 3424;
const expect = require('chai').expect;
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import axios from 'axios';

const request = chai.request.agent(app);

describe('Version API', () => {

    it('should get the current helm-chart version', function () {
        const response = axios.get('/helm-chart/version');
        expect(response).to.have.status(200);
        expect(response.body.helmChartVersion).to.be.equal(
            process.env['npm_package_version']
        );
    });
});
