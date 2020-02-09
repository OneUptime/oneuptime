const MongoClient = require('mongodb').MongoClient;
const url = process.env['MONGO_URL'] || 'mongodb://localhost/fyipedb';

async function connectToDb() {
  return MongoClient.connect(url, { useUnifiedTopology: true });
}

async function find(collection, query = {}) {
  return global.db.collection(collection).find(query).toArray();
}

async function save(collection, doc) {
  return global.db.collection(collection).insertMany([doc]);
}

async function update(collection, query, value) {
  return global.db.collection(collection).updateOne(
    query,
    { $set: value }
  );
}

module.exports = {
  connectToDb,
  find,
  save,
  update
};
