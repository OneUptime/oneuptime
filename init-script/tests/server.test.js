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
const fs = require('fs');

var ScriptFiles = [];

beforeEach((done) => {
    fs.readdir('./scripts', (err, files) => {
        
        if(err){
            console.error(err);
        }

        ScriptFiles = files;
        ScriptFiles.forEach(
            mocked_script => {
                jest.mock(
                    `../scripts/${mocked_script}`,
                    () => () => console.info(`${mocked_script}`),
                    { virtual: true }
                );
            }
        );
        done();
    });
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

