/* eslint-disable */

const PKG_VERSION = parseInt(require('../package.json').version.split('.')[2]);

const { mockDbClient } = require('./helper');

mockDbClient();

const server = require('../server');
const scriptsObject = require('../scripts');
const utilObject = require('../util/db');

const connectToDb = jest.spyOn(utilObject, 'connectToDb');
const start = jest.spyOn(scriptsObject, 'start');
const end = jest.spyOn(scriptsObject, 'end');

const MOCKED_SCRIPTS = [
    PKG_VERSION - 1,
    PKG_VERSION,
    PKG_VERSION + 1,
    PKG_VERSION + 2,
];

beforeEach(() => {
    require('fs').readdirSync = jest
        .fn()
        .mockReturnValue(MOCKED_SCRIPTS.map(script => `3.0.${script}.js`));

    MOCKED_SCRIPTS.filter(script => script > PKG_VERSION).forEach(
        mocked_script => {
            jest.mock(
                `../scripts/3.0.${mocked_script}.js`,
                () => () => console.info(`3.0.${mocked_script}`),
                { virtual: true }
            );
        }
    );
});

afterEach(() => jest.clearAllMocks());

test('Should connect to db', async () => {
    await server();
    expect(connectToDb).toBeCalled();
});

test('Should call start script', async () => {
    await server();
    expect(start).toBeCalled();
});

test('Should call end script', async () => {
    await server();
    expect(end).toBeCalled();
});

test('Should only execute scripts ahead of current version', async () => {
    const spy = jest.spyOn(console, 'info');
    await server();
    MOCKED_SCRIPTS.filter(script => script > PKG_VERSION).forEach(script => {
        expect(spy).toHaveBeenCalledWith(`3.0.${script}`);
    });
});
