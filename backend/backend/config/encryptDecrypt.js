const crypto = require('crypto');
const EncryptionKeys = require('./encryptionKeys');
const algorithm = EncryptionKeys.algorithm;
const key = EncryptionKeys.key;
const iv = EncryptionKeys.iv;

module.exports = {
    encrypt: (plainText) => {
        let promise = new Promise((resolve, reject) => {
            try {
                var cipher = crypto.createCipheriv(algorithm, key, iv);
                var encoded = cipher.update(plainText, 'utf8', 'hex');
                encoded += cipher.final('hex');
                resolve(encoded);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    },

    decrypt: (encText) => {
        let promise = new Promise((resolve, reject) => {
            try {
                var decipher = crypto.createDecipheriv(algorithm, key, iv);
                var decoded = decipher.update(encText, 'hex', 'utf8');
                decoded += decipher.final('utf8');
                resolve(decoded);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    }
};