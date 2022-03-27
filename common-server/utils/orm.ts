import mongoose from 'mongoose';
import logger from './logger';

import { databaseUrl, isMongoReplicaSet } from '../config';

let options = {};

if (isMongoReplicaSet) {
    options = {
        // commented because this was having issues reading "latest" data that was saved on primary.
        // readPreference: 'secondaryPreferred',
        keepAlive: 1,
    };
}

mongoose
    .connect(databaseUrl, options)
    .then(() => {
        return logger.info('Mongo connected');
    })
    .catch(err => {
        // mongoose connection error will be handled here
        logger.error(err);
        process.exit(1);
    });

export default mongoose;
