const MongoClient = require('mongodb').MongoClient;
const url = process.env['MONGO_URL'] || 'mongodb://localhost/fyipedb';

global.client = global.client || MongoClient;

async function connectToDb() {
    return global.client.connect(url, { useUnifiedTopology: true });
}

async function find(collection, query = {}) {
    return global.db
        .collection(collection)
        .find(query)
        .toArray();
}

async function save(collection, docs) {
    return global.db.collection(collection).insertMany(docs);
}

async function update(collection, query, value) {
    return global.db.collection(collection).updateOne(query, { $set: value });
}

module.exports = {
    connectToDb,
    find,
    save,
    update,
};
