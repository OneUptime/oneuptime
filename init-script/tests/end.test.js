/* eslint-disable no-undef */

const PKG_VERSION = require('../package.json').version;
const { mockDbCollection } = require('./helper');

const util = require('../util/db');
const update = jest.spyOn(util, 'update');

const end = require('../scripts/end');

test('Should update GlobalConfig record with name "version" to package version', async () => {
    mockDbCollection();
    await end();
    expect(update).toBeCalledWith(
        'GlobalConfig',
        { name: 'version' },
        { value: PKG_VERSION }
    );
});
