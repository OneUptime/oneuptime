import utils from '../../test-utils';

import axios from 'axios';
import init from '../../test-init';

describe('Version API', (): void => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        done();
    });

    test('should get status ok from backend', async (done: $TSFixMe) => {
        const response: $TSFixMe = await axios(
            utils.APIDOCS_URL + '/docs/version'
        );
        expect(response.data.docsVersion).toBeDefined();
        done();
    });
});
