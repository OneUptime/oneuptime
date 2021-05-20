const utils = require('../../test-utils');
const axios = require('axios');
const init = require('../../test-init');

describe('Version API', function() {
    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        jest.retryTimes(3);
        done();
    });

    afterAll(async done => {
        done();
    });

    test('should get status ok from backend', async done => {
        const response = await axios(utils.APIDOCS_URL + '/docs/version');
        expect(response.data.docsVersion).toBeDefined();
        done();
    });
});
