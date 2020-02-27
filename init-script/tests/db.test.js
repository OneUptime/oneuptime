/* eslint-disable no-undef */

const url = process.env['MONGO_URL'] || 'mongodb://localhost/fyipedb';
const collection = 'GlobalConfig';

const {
    collectionObject,
    mockDbCollection,
    mockDbClient,
} = require('./helper');
const { connectToDb, find, save, update } = require('../util/db');

mockDbClient();
mockDbCollection();

test('Should connect to db', async () => {
    await connectToDb();
    expect(global.client.connect).toBeCalledWith(url, {
        useUnifiedTopology: true,
    });
});

test('Should query db', async () => {
    const query = { a: 1 };
    await find(collection, query);
    expect(collectionObject.find).toBeCalledWith(query);
});

test('Should insert record to db', async () => {
    await save(collection, { a: 1 });
    expect(collectionObject.insertMany).toBeCalledWith([{ a: 1 }]);
});

test('Should update record in db', async () => {
    const query = { a: 1 },
        value = { a: 2 };
    await update(collection, query, value);
    expect(collectionObject.updateOne).toBeCalledWith(query, { $set: value });
});
