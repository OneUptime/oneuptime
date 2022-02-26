import crypto from 'crypto'
import EncryptionKeys from './encryptionKeys'
const algorithm = EncryptionKeys.algorithm;
const key = EncryptionKeys.key;

export default {
    encrypt: (plainText: $TSFixMe, iv: $TSFixMe) => {
        const promise = new Promise((resolve, reject) => {
            try {
                // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'iv' does not exist on type '{ algorithm:... Remove this comment to see the full error message
    decrypt: (encText: $TSFixMe, iv = EncryptionKeys.iv) => {
        const promise = new Promise((resolve, reject) => {
            try {
                // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                const decipher = crypto.createDecipheriv(algorithm, key, iv);
                let decoded = decipher.update(encText, 'hex', 'utf8');
                decoded += decipher.final('utf8');
                resolve(decoded);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    },
};
