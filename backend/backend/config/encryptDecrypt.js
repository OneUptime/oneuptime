const crypto = require('crypto');
const EncryptionKeys = require('./encryptionKeys');
const algorithm = EncryptionKeys.algorithm;
const key = EncryptionKeys.key;
const iv = EncryptionKeys.iv;

module.exports = {
    encrypt: (plainText) => {
        const promise = new Promise((resolve, reject) => {
            try {
                const cipher = crypto.createCipheriv(algorithm, key, iv);
                let encoded = cipher.update(plainText, 'utf8', 'hex');
                encoded += cipher.final('hex');
                resolve(encoded);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    },

    decrypt: (encText) => {
        const promise = new Promise((resolve, reject) => {
            try {
                const decipher = crypto.createDecipheriv(algorithm, key, iv);
                let decoded = decipher.update(encText, 'hex', 'utf8');
                decoded += decipher.final('utf8');
                resolve(decoded);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    }
};