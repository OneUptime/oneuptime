/* eslint-disable no-undef */

const PKG_VERSION = require('../package.json').version;
const { mockDbCollection } = require('./helper');

const util = require('../util/db');
const find = jest.spyOn(util, 'find');
const save = jest.spyOn(util, 'save');

const start = require('../scripts/start');

test('Should query GlobalConfig for record with name "version"', async () => {
  mockDbCollection(true);
  await start();
  expect(find).toBeCalledWith('GlobalConfig', { name: 'version' });
});

test('Should save record to GlobalConfig if no records are found', async () => {
  mockDbCollection();
  await start();
  expect(save).toBeCalledWith(
    'GlobalConfig',
    { name: 'version', value: PKG_VERSION }
  );
});
