import Crypto from 'crypto';
import { EncryptionSecret } from '../Config';

export default class Encryption {
    public static encrypt(text: string, iv: Buffer): string {
        const cipher: Crypto.Cipher = Crypto.createCipheriv(
            'aes-256-cbc',
            EncryptionSecret.toString(),
            iv
        );
        return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    }

    public static decrypt(encrypted: string, iv: Buffer): string {
        const decipher: Crypto.Cipher = Crypto.createDecipheriv(
            'aes-256-cbc',
            EncryptionSecret.toString(),
            iv
        );
        return (
            decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
        );
    }

    public static getIV(): Buffer {
        const iv: Buffer = Crypto.randomBytes(16);
        return iv;
    }
}
