import { GridFsStorage } from 'multer-gridfs-storage';
import crypto from 'crypto';

const mongoUri = process.env['MONGO_URL'];

// Description: Generating random name of files.
// Returns: fileinfo, error.
export default new GridFsStorage({
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
    url: mongoUri,
    options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    },
    file: () => {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(16, (err, random) => {
                if (err) {
                    return reject(err);
                }
                const id = random.toString('hex');
                const fileInfo = {
                    _id: id,
                    bucketName: 'uploads',
                };
                resolve(fileInfo);
            });
        });
    },
});
