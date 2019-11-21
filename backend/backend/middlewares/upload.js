/**
 *
 * Copyright HackerBay, Inc.
 *
 */


var GridFsStorage = require('multer-gridfs-storage');
var crypto = require('crypto');
var keys = require('../config/keys');

var mongoUri = keys.dbURL;

// Description: Generating random name of files.
// Returns: fileinfo, error.
module.exports = new GridFsStorage({
    url: mongoUri,

    // eslint-disable-next-line no-unused-vars
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(16, (err, random) => {
                if (err) {
                    return reject(err);
                }
                const id = random.toString('hex');
                const fileInfo = {
                    _id: id,
                    bucketName: 'uploads'
                };
                resolve(fileInfo);
            });
        });
    }
});