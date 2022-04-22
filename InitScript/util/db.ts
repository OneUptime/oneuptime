const MongoClient: $TSFixMe = require('mongodb').MongoClient;
const url: $TSFixMe =
    process.env['MONGO_URL'] || 'mongodb://localhost/oneuptimedb';
import Query from 'CommonServer/types/db/Query';
global.client = global.client || MongoClient;

async function connectToDb(): void {
    return global.client.connect(url, { useUnifiedTopology: true });
}

async function find(
    collection: $TSFixMe,
    query = {},
    sort = null,
    limit = 0
): void {
    if (sort) {
        return global.db
            .collection(collection)
            .find(query)
            .limit(limit)
            .sort(sort)
            .toArray();
    }

    return global.db.collection(collection).find(query).limit(limit).toArray();
}

async function findOne(collection: $TSFixMe, query = {}): void {
    return global.db.collection(collection).findOne(query);
}

async function save(collection: $TSFixMe, docs: $TSFixMe): void {
    return global.db.collection(collection).insertMany(docs);
}

async function update(
    collection: $TSFixMe,
    query: Query,
    value: $TSFixMe
): void {
    return global.db.collection(collection).updateOne(query, { $set: value });
}

async function updateMany(
    collection: $TSFixMe,
    query: Query,
    value: $TSFixMe
): void {
    return global.db.collection(collection).updateMany(query, { $set: value });
}

async function customUpdate(
    collection: $TSFixMe,
    query: Query,
    value: $TSFixMe
): void {
    return global.db.collection(collection).updateMany(query, value);
}
async function removeMany(collection: $TSFixMe, query: Query): void {
    return global.db.collection(collection).remove(query, { multi: true });
}

async function removeField(
    collection: $TSFixMe,
    query: Query,
    field: $TSFixMe
): void {
    return global.db
        .collection(collection)
        .updateOne(query, { $unset: { [field]: '' } }, { multi: true });
}
async function removeFieldsFromMany(
    collection: $TSFixMe,
    query: Query,
    field: $TSFixMe
): void {
    return global.db
        .collection(collection)
        .updateMany(query, { $unset: { [field]: '' } }, { multi: true });
}

async function rename(
    oldCollectionName: $TSFixMe,
    newCollectionName: $TSFixMe
): void {
    return global.db
        .listCollections({ name: oldCollectionName })
        .next((err: $TSFixMe, collinfo: $TSFixMe): void => {
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
async function deleteDatabase(): void {
    if (process.env['NODE_ENV'] === 'development') {
        await global.db.dropDatabase();
    }
}

async function getVersion(): void {
    const docs: $TSFixMe = await global.db
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
