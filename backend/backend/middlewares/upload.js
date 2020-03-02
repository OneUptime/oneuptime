/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const GridFsStorage = require('multer-gridfs-storage');
const crypto = require('crypto');

const mongoUri = process.env['MONGO_URL'];
const db = require('../config/db').connect(mongoUri);

// Description: Generating random name of files.
// Returns: fileinfo, error.
module.exports = new GridFsStorage({
    db,
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
