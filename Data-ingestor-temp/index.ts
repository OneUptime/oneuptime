import logger from 'common-server/Utils/Logger';
import app from 'common-server/utils/StartServer';

import http from 'http';
http.createServer(app);

import { mongoUrl, databaseName } from './utils/config';
const MongoClient = require('mongodb').MongoClient;

// mongodb
function getMongoClient() {
    return new MongoClient(mongoUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
}
// setup mongodb connection
const client = getMongoClient();
(async function () {
    try {
        logger.info('connecting to db');
        await client.connect();
        logger.info('connected to db');
    } catch (error) {
        logger.error('connection error: ', error);
    }
})();

// attach the database to global object

global.db = client.db(databaseName);

app.use(['/data-ingestor/probe', '/probe'], require('./api/probe'));

export default app;
