const MongoClient = require('mongodb').MongoClient;
const url = process.env['MONGO_URL'] || 'mongodb://localhost/oneuptimedb';

global.client = global.client || MongoClient;

async function connectToDb() {
    return global.client.connect(url, { useUnifiedTopology: true });
}

async function find(collection, query = {}, sort = null, limit = 0) {
    if (sort) {
        return global.db
            .collection(collection)
            .find(query)
            .limit(limit)
            .sort(sort)
            .toArray();
    }

    return global.db
        .collection(collection)
        .find(query)
        .limit(limit)
        .toArray();
}

async function findOne(collection, query = {}) {
    return global.db.collection(collection).findOne(query);
}

async function save(collection, docs) {
    return global.db.collection(collection).insertMany(docs);
}

async function update(collection, query, value) {
    return global.db.collection(collection).updateOne(query, { $set: value });
}

async function updateMany(collection, query, value) {
    return global.db.collection(collection).updateMany(query, { $set: value });
}

async function customUpdate(collection, query, value) {
    return global.db.collection(collection).updateMany(query, value);
}
async function removeMany(collection, query) {
    return global.db.collection(collection).remove(query, { multi: true });
}

async function removeField(collection, query, field) {
    return global.db
        .collection(collection)
        .updateOne(query, { $unset: { [field]: '' } }, { multi: true });
}
async function removeFieldsFromMany(collection, query, field) {
    return global.db
        .collection(collection)
        .updateMany(query, { $unset: { [field]: '' } }, { multi: true });
}

async function rename(oldCollectionName, newCollectionName) {
    return global.db
        .listCollections({ name: oldCollectionName })
        .next(function(err, collinfo) {
            if (collinfo) {
                // The collection exists
                global.db
                    .collection(oldCollectionName)
                    .rename(newCollectionName);
            }
        });
}

/**
 *
 * You should NEVER use this function. This is just used for tests.
 */
async function deleteDatabase() {
    if (process.env['NODE_ENV'] === 'development') {
        await global.db.dropDatabase();
    }
}

async function getVersion() {
    const docs = await global.db
        .collection('globalconfigs')
        .find({ name: 'version' })
        .toArray();

    if (docs.length > 0) {
        return docs[0].value;
    }

    return null;
}

export default {
    connectToDb,
    find,
    findOne,
    save,
    update,
    getVersion,
    removeField,
    rename,
    updateMany,
    removeMany,
    removeFieldsFromMany,
    deleteDatabase,
    customUpdate,
};
