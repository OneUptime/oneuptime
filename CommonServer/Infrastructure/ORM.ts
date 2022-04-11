import mongoose from 'mongoose';
import logger from '../Utils/Logger';

import { DatabaseUrl, IsMongoReplicaSet } from '../Config';

let options = {};

if (IsMongoReplicaSet) {
    options = {
        // commented because this was having issues reading "latest" data that was saved on primary.
        // readPreference: 'secondaryPreferred',
        keepAlive: 1,
    };
}

mongoose
    .connect(DatabaseUrl, options)
    .then(() => {
        return logger.info('Mongo connected');
    })
    .catch(err => {
        // mongoose connection error will be handled here
        logger.error(err);
        process.exit(1);
    });

export default mongoose;

export interface Document extends mongoose.Document {}

export interface Model<T> extends mongoose.Model<T> {}

export interface RequiredFields extends Array<string> {}

export interface UniqueFields extends Array<string> {}

export interface EncryptedFields extends Array<string> {}
