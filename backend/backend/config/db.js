import mongoose from 'mongoose'
import logger from 'common-server/utils/logger'
const mongoUrl =
    process.env['MONGO_URL'] || 'mongodb://localhost:27017/oneuptimedb';

mongoose.set('useNewUrlParser', true);
mongoose.set('useUnifiedTopology', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);

let options = {};

if (process.env.IS_MONGO_REPLICA_SET) {
    options = {
        // commented because this was having issues reading "latest" data that was saved on primary.
        // readPreference: 'secondaryPreferred',
        keepAlive: 1,
    };
}

mongoose
    .connect(mongoUrl, options)
    .then(() => {
        return logger.info('Mongo connected');
    })
    .catch(err => {
        // mongoose connection error will be handled here
        logger.error(err);
        process.exit(1);
    });

export default mongoose;
