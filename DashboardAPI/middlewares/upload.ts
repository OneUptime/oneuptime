import { GridFsStorage } from 'multer-gridfs-storage';
import crypto from 'crypto';

const mongoUri: $TSFixMe = process.env['MONGO_URL'];

/*
 * Description: Generating random name of files.
 * Returns: fileinfo, error.
 */
export default new GridFsStorage({
    url: mongoUri,
    options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    },
    file: () => {
        return new Promise((resolve: Function, reject: Function) => {
            crypto.randomBytes(16, (err: $TSFixMe, random: $TSFixMe) => {
                if (err) {
                    return reject(err);
                }
                const id: $TSFixMe = random.toString('hex');
                const fileInfo: $TSFixMe = {
                    _id: id,
                    bucketName: 'uploads',
                };
                resolve(fileInfo);
            });
        });
    },
});
