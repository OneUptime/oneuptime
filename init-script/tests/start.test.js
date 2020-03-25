/* eslint-disable no-undef */

const PKG_VERSION = require('../package.json').version;
const { mockDbCollection } = require('./helper');

const util = require('../util/db');
const find = jest.spyOn(util, 'find');
const save = jest.spyOn(util, 'save');

const start = require('../scripts/start');

test('Should query globalconfigs for record with name "version"', async () => {
    mockDbCollection(true);
    await start();
    expect(find).toBeCalledWith('globalconfigs', { name: 'version' });
});

test('Should save record to globalconfigs if no records are found', async () => {
    mockDbCollection();
    await start();
    expect(save).toBeCalledWith('globalconfigs', [
        {
            name: 'version',
            value: PKG_VERSION,
        },
    ]);
});
